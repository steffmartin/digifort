using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class DigifortArtwork
{
    private static readonly Color Green = Color.FromArgb(83, 203, 183);
    private static readonly Color DarkGreen = Color.FromArgb(34, 127, 118);
    private static readonly Color Amber = Color.FromArgb(227, 174, 104);
    private static readonly Color Dark = Color.FromArgb(16, 23, 25);

    private static void DrawCamera(Graphics drawing, float x, float y, float size)
    {
        var state = drawing.Save();
        drawing.TranslateTransform(x, y);
        drawing.ScaleTransform(size / 64, size / 64);
        drawing.SmoothingMode = SmoothingMode.AntiAlias;
        using (var body = new GraphicsPath())
        using (var lens = new GraphicsPath())
        using (var fill = new SolidBrush(DarkGreen))
        using (var green = new SolidBrush(Green))
        using (var amber = new SolidBrush(Amber))
        using (var outline = new Pen(Green, 4))
        {
            body.AddArc(5, 17, 14, 14, 180, 90);
            body.AddArc(27, 17, 14, 14, 270, 90);
            body.AddArc(27, 33, 14, 14, 0, 90);
            body.AddArc(5, 33, 14, 14, 90, 90);
            body.CloseFigure();
            lens.AddPolygon(new[] { new PointF(39, 25), new PointF(58, 16), new PointF(58, 48), new PointF(39, 39) });
            outline.LineJoin = LineJoin.Round;
            drawing.FillPath(green, lens);
            drawing.DrawPath(outline, lens);
            drawing.FillPath(fill, body);
            drawing.DrawPath(outline, body);
            drawing.FillEllipse(amber, 12, 24, 7, 7);
            outline.Width = 3;
            outline.StartCap = outline.EndCap = LineCap.Round;
            drawing.DrawLine(outline, 14, 39, 32, 39);
        }
        drawing.Restore(state);
    }

    private static void WriteIcon(string path)
    {
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
        byte[][] images = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
        using (var image = new Bitmap(sizes[i], sizes[i], PixelFormat.Format32bppArgb))
        using (var drawing = Graphics.FromImage(image))
        using (var png = new MemoryStream())
        {
            DrawCamera(drawing, 0, 0, sizes[i]);
            image.Save(png, ImageFormat.Png);
            images[i] = png.ToArray();
        }
        using (var icon = new BinaryWriter(File.Create(path)))
        {
            icon.Write((ushort)0);
            icon.Write((ushort)1);
            icon.Write((ushort)sizes.Length);
            int offset = 6 + sizes.Length * 16;
            for (int i = 0; i < sizes.Length; i++)
            {
                icon.Write((byte)(sizes[i] % 256));
                icon.Write((byte)(sizes[i] % 256));
                icon.Write((ushort)0);
                icon.Write((ushort)1);
                icon.Write((ushort)32);
                icon.Write(images[i].Length);
                icon.Write(offset);
                offset += images[i].Length;
            }
            foreach (var image in images) icon.Write(image);
        }
    }

    public static void Generate(string directory)
    {
        WriteIcon(Path.Combine(directory, "camera.ico"));
        using (var image = new Bitmap(164, 314, PixelFormat.Format24bppRgb))
        using (var drawing = Graphics.FromImage(image))
        using (var background = new LinearGradientBrush(new Rectangle(0, 0, 164, 314), Dark, Color.FromArgb(22, 53, 52), 65))
        using (var accent = new Pen(Color.FromArgb(47, 88, 85), 1))
        {
            drawing.FillRectangle(background, 0, 0, 164, 314);
            for (int x = -72; x < 164; x += 16) drawing.DrawLine(accent, x, 314, x + 104, 210);
            DrawCamera(drawing, 28, 102, 108);
            image.Save(Path.Combine(directory, "wizard.bmp"), ImageFormat.Bmp);
        }
        using (var image = new Bitmap(55, 55, PixelFormat.Format24bppRgb))
        using (var drawing = Graphics.FromImage(image))
        {
            drawing.Clear(Dark);
            DrawCamera(drawing, 4, 4, 47);
            image.Save(Path.Combine(directory, "wizard-small.bmp"), ImageFormat.Bmp);
        }
    }
}
