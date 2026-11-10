using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Digifort Monitor")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

internal static class Launcher
{
    private const string Title = "Digifort Monitor";
    private const string InstanceName = @"Local\DigifortMonitor.Launcher";
    private const string WindowProperty = "DigifortMonitor.AppWindow";
    private const string Url = "http://127.0.0.1:4177/";
    private const string BrowserRequired = "Instale o Google Chrome ou um Chromium compatível e tente novamente.";

    [STAThread]
    private static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--check-browser") >= 0) return FindBrowser() == null ? 1 : 0;

        bool diagnostic = Array.IndexOf(args, "--diagnostico") >= 0;
        if (diagnostic) Native.AttachConsole(-1);
        try
        {
            int sourceIndex = Array.IndexOf(args, "--source");
            bool source = sourceIndex >= 0 && sourceIndex + 1 < args.Length;
            string root = source ? Path.GetFullPath(args[sourceIndex + 1]) : AppDomain.CurrentDomain.BaseDirectory;
            string data = Environment.GetEnvironmentVariable("DIGIFORT_DATA_DIR");
            if (String.IsNullOrWhiteSpace(data))
                data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Title);
            string config = source ? Path.Combine(root, "config") : Path.Combine(data, "config");
            if (Array.IndexOf(args, "--config-folder") >= 0)
            {
                OpenConfig(config);
                return 0;
            }

            bool first;
            using (var instance = new Mutex(true, InstanceName, out first))
            using (var activate = new EventWaitHandle(false, EventResetMode.AutoReset, InstanceName + ".Activate"))
            {
                if (!first)
                {
                    IntPtr window = Native.FindWindow(handle => Native.GetProp(handle, WindowProperty) != IntPtr.Zero);
                    if (window != IntPtr.Zero) Native.Activate(window);
                    else activate.Set();
                    return 0;
                }
                return Run(root, data, config, source, diagnostic, activate);
            }
        }
        catch (Exception error)
        {
            if (diagnostic) Console.Error.WriteLine(error.Message);
            MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int Run(string root, string data, string config, bool source, bool diagnostic, EventWaitHandle activate)
    {
        string browserPath = FindBrowser();
        if (browserPath == null) throw new InvalidOperationException(BrowserRequired);
        string nodePath = source ? FindOnPath("node.exe") : Path.Combine(root, "runtime", "node.exe");
        if (nodePath == null || !File.Exists(nodePath))
            throw new InvalidOperationException(source ? "Instale o Node.js 20 ou superior para executar a partir do código-fonte." : "O runtime Node.js está ausente. Reinstale o Digifort Monitor.");

        Directory.CreateDirectory(config);
        string profile = Path.GetFullPath(Path.Combine(data, "ChromeProfile"));
        Directory.CreateDirectory(profile);
        var info = new ProcessStartInfo(nodePath, Quote(Path.Combine(root, "server.mjs")) + " --launcher");
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8;
        info.StandardErrorEncoding = Encoding.UTF8;
        info.EnvironmentVariables["PORT"] = "4177";
        info.EnvironmentVariables["DIGIFORT_CONFIG_DIR"] = config;
        if (!source) info.EnvironmentVariables.Remove("NODE_OPTIONS");

        using (var serverJob = new ProcessJob())
        using (var ready = new ManualResetEvent(false))
        using (var closeRequested = new AutoResetEvent(false))
        using (var server = new Process { StartInfo = info })
        {
            bool portInUse = false;
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                switch (e.Data)
                {
                    case "DIGIFORT_READY": ready.Set(); break;
                    case "DIGIFORT_PORT_IN_USE": portInUse = true; break;
                    case "DIGIFORT_CLOSE_APP": closeRequested.Set(); break;
                    case "DIGIFORT_OPEN_CONFIG":
                        try { OpenConfig(config); }
                        catch (Exception error) { MessageBox.Show(error.Message, Title); }
                        break;
                    case null: break;
                    default: if (diagnostic) Console.WriteLine(e.Data); break;
                }
            };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (diagnostic && e.Data != null) Console.Error.WriteLine(e.Data);
            };
            server.Start();
            try { serverJob.Add(server.Handle); }
            catch { server.Kill(); throw; }
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            try
            {
                var timeout = Stopwatch.StartNew();
                while (!ready.WaitOne(100) && !server.HasExited && timeout.ElapsedMilliseconds < 20000) { }
                if (server.HasExited)
                {
                    server.WaitForExit();
                    if (portInUse) throw new InvalidOperationException("A porta local 4177 está em uso. Feche o programa que a utiliza e abra o Digifort Monitor novamente.");
                    throw new InvalidOperationException("O servidor local encerrou durante a inicialização. Use --diagnostico para ver os detalhes.");
                }
                if (!ready.WaitOne(0)) throw new TimeoutException("O servidor local não ficou pronto a tempo.");

                string browserArgs = "--app=" + Url + " --user-data-dir=" + Quote(profile) +
                    " --no-first-run --no-default-browser-check --disable-background-mode --disable-session-crashed-bubble";
                using (var browserJob = new ProcessJob())
                using (var browser = browserJob.Start(browserPath, browserArgs))
                {
                    WatchWindow(browser, server, activate, closeRequested, Path.Combine(data, "window-placement.txt"));
                    browser.WaitForExit(1500);
                }
                return 0;
            }
            finally
            {
                if (!server.HasExited)
                {
                    try { server.StandardInput.WriteLine("shutdown"); }
                    catch (IOException) { }
                    if (!server.WaitForExit(8000))
                    {
                        if (diagnostic) Console.Error.WriteLine("Tempo de encerramento excedido. Encerrando o processo do servidor.");
                        serverJob.Dispose();
                    }
                    server.WaitForExit();
                }
            }
        }
    }

    private static void WatchWindow(Process browser, Process server, EventWaitHandle activate, EventWaitHandle closeRequested, string placementFile)
    {
        IntPtr window = IntPtr.Zero;
        var timeout = Stopwatch.StartNew();
        while (window == IntPtr.Zero && !browser.HasExited && !server.HasExited && timeout.ElapsedMilliseconds < 25000)
        {
            window = Native.FindWindow(handle => Native.IsBrowserWindow(handle, browser.Id));
            if (window == IntPtr.Zero) Thread.Sleep(100);
        }
        if (window == IntPtr.Zero) throw new InvalidOperationException("Não foi possível abrir a janela do Digifort Monitor no navegador.");
        Native.SetProp(window, WindowProperty, new IntPtr(1));
        Native.WindowPlacement placement = LoadPlacement(placementFile);
        if (placement.Show != 0) Native.SetWindowPlacement(window, ref placement);
        var signals = new WaitHandle[] { activate, closeRequested };
        var current = new Native.WindowPlacement { Length = Marshal.SizeOf(typeof(Native.WindowPlacement)) };
        while (!browser.HasExited && Native.IsWindow(window) && !server.HasExited)
        {
            if (Native.GetWindowPlacement(window, ref current) && (current.Show == 1 || current.Show == 3)) placement = current;
            int signal = WaitHandle.WaitAny(signals, 75);
            if (signal == 0) Native.Activate(window);
            if (signal == 1) Native.CloseWindow(window);
        }
        SavePlacement(placementFile, placement);
        if (server.HasExited) throw new InvalidOperationException("O servidor local do Digifort Monitor foi encerrado inesperadamente.");
    }

    private static Native.WindowPlacement LoadPlacement(string path)
    {
        try
        {
            string[] fields = File.ReadAllText(path).Split(' ');
            var values = new int[9];
            if (fields.Length != values.Length) return default(Native.WindowPlacement);
            for (int i = 0; i < values.Length; i++)
                if (!Int32.TryParse(fields[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out values[i])) return default(Native.WindowPlacement);
            if ((values[0] != 1 && values[0] != 3) || values[3] <= values[1] || values[4] <= values[2]) return default(Native.WindowPlacement);
            return new Native.WindowPlacement {
                Length = Marshal.SizeOf(typeof(Native.WindowPlacement)), Show = values[0],
                Left = values[1], Top = values[2], Right = values[3], Bottom = values[4],
                MinX = values[5], MinY = values[6], MaxX = values[7], MaxY = values[8]
            };
        }
        catch (IOException) { return default(Native.WindowPlacement); }
        catch (UnauthorizedAccessException) { return default(Native.WindowPlacement); }
    }

    private static void SavePlacement(string path, Native.WindowPlacement placement)
    {
        if (placement.Show == 0) return;
        string pending = path + ".tmp";
        try
        {
            int[] values = {
                placement.Show, placement.Left, placement.Top, placement.Right, placement.Bottom,
                placement.MinX, placement.MinY, placement.MaxX, placement.MaxY
            };
            File.WriteAllText(pending, String.Join(" ", Array.ConvertAll(values, value => value.ToString(CultureInfo.InvariantCulture))));
            if (File.Exists(path)) File.Replace(pending, path, null);
            else File.Move(pending, path);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void OpenConfig(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), Quote(path));
    }

    private static string FindBrowser()
    {
        string[] folders = {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        string chrome = FindInFolders(folders, @"Google\Chrome\Application\chrome.exe") ??
            FindRegistered("chrome.exe") ?? FindOnPath("chrome.exe");
        if (chrome != null) return chrome;

        foreach (string relative in new[] { @"Chromium\Application\chrome.exe", @"Chromium\Application\chromium.exe", @"Chromium\chrome.exe", @"Chromium\chromium.exe" })
        {
            string candidate = FindInFolders(folders, relative);
            if (candidate != null) return candidate;
        }
        return FindRegistered("chromium.exe") ?? FindOnPath("chromium.exe");
    }

    private static string FindInFolders(string[] folders, string relative)
    {
        foreach (string folder in folders)
        {
            if (String.IsNullOrEmpty(folder)) continue;
            string candidate = Path.Combine(folder, relative);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static string FindRegistered(string executable)
    {
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        using (var registry = RegistryKey.OpenBaseKey(hive, view))
        using (var key = registry.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + executable))
        {
            string value = key == null ? null : key.GetValue("") as string;
            if (String.IsNullOrWhiteSpace(value)) continue;
            string path = Environment.ExpandEnvironmentVariables(value.Trim().Trim('"'));
            if (Path.IsPathRooted(path) && File.Exists(path)) return path;
        }
        return null;
    }

    private static string FindOnPath(string executable)
    {
        foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            string folder = entry.Trim().Trim('"');
            if (!Path.IsPathRooted(folder)) continue;
            string candidate = Path.Combine(folder, executable);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    internal static string Quote(string path) { return "\"" + path.TrimEnd('\\') + "\""; }
}

internal sealed class ProcessJob : IDisposable
{
    private IntPtr handle;

    internal ProcessJob()
    {
        handle = Native.CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception();
        var limits = new Native.JobLimits();
        limits.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!Native.SetInformationJobObject(handle, 9, ref limits, Marshal.SizeOf(limits)))
        {
            var error = new Win32Exception();
            Dispose();
            throw error;
        }
    }

    internal void Add(IntPtr process)
    {
        if (!Native.AssignProcessToJobObject(handle, process)) throw new Win32Exception();
    }

    internal Process Start(string executable, string arguments)
    {
        var startup = new Native.StartupInfo { Size = Marshal.SizeOf(typeof(Native.StartupInfo)) };
        Native.ProcessInfo info;
        var command = new StringBuilder(Launcher.Quote(executable) + " " + arguments);
        // Assign the suspended browser before it can spawn its renderers.
        if (!Native.CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 4, IntPtr.Zero, null, ref startup, out info))
            throw new Win32Exception();
        try
        {
            Add(info.Process);
            var process = Process.GetProcessById(info.Id);
            if (Native.ResumeThread(info.Thread) != UInt32.MaxValue) return process;
            process.Dispose();
            throw new Win32Exception();
        }
        catch
        {
            Native.TerminateProcess(info.Process, 1);
            throw;
        }
        finally
        {
            Native.CloseHandle(info.Thread);
            Native.CloseHandle(info.Process);
        }
    }

    public void Dispose()
    {
        if (handle != IntPtr.Zero) Native.CloseHandle(handle);
        handle = IntPtr.Zero;
    }
}

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct WindowPlacement
    {
        internal int Length, Flags, Show, MinX, MinY, MaxX, MaxY, Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct BasicLimits
    {
        internal long ProcessTime, JobTime;
        internal uint LimitFlags;
        internal UIntPtr MinWorkingSet, MaxWorkingSet;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobLimits
    {
        internal BasicLimits Basic;
        internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct StartupInfo
    {
        internal int Size;
        internal IntPtr Reserved, Desktop, Title;
        internal uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        internal ushort Show, ReservedSize;
        internal IntPtr ReservedData, StandardIn, StandardOut, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ProcessInfo
    {
        internal IntPtr Process, Thread;
        internal int Id, ThreadId;
    }

    internal static IntPtr FindWindow(Predicate<IntPtr> matches)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr ignored)
        {
            if (!matches(window)) return true;
            result = window;
            return false;
        }, IntPtr.Zero);
        return result;
    }

    internal static bool IsBrowserWindow(IntPtr window, int pid)
    {
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owner != pid || !IsWindowVisible(window)) return false;
        var className = new StringBuilder(64);
        GetClassName(window, className, className.Capacity);
        return className.ToString() == "Chrome_WidgetWin_1";
    }

    internal static void Activate(IntPtr window)
    {
        if (IsIconic(window)) ShowWindowAsync(window, 9);
        if (!SetForegroundWindow(window)) FlashWindow(window, true);
    }

    internal static void CloseWindow(IntPtr window) { PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero); } // WM_CLOSE

    private delegate bool WindowCallback(IntPtr window, IntPtr ignored);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr ignored);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool FlashWindow(IntPtr window, bool invert);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] internal static extern bool GetWindowPlacement(IntPtr window, ref WindowPlacement placement);
    [DllImport("user32.dll")] internal static extern bool SetWindowPlacement(IntPtr window, ref WindowPlacement placement);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool SetProp(IntPtr window, string property, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetProp(IntPtr window, string property);
    [DllImport("kernel32.dll")] internal static extern bool AttachConsole(int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int type, ref JobLimits limits, int length);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string file, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string workingDirectory, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
}
