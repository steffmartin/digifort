using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Globalization;
using System.Text;

public static class DigifortArtwork
{
    private static readonly Color Green = Color.FromArgb(83, 203, 183);
    private static readonly Color DarkGreen = Color.FromArgb(34, 127, 118);
    private static readonly Color Amber = Color.FromArgb(227, 174, 104);
    private static readonly Color Dark = Color.FromArgb(16, 23, 25);
    private const int OutlineWidth = 4;
    private const int DotX = 12, DotY = 24, DotSize = 7;
    private const int LineX1 = 14, LineX2 = 32, LineY = 39, LineWidth = 3;

    private static GraphicsPath CameraBody()
    {
        var body = new GraphicsPath();
        body.AddArc(5, 17, 14, 14, 180, 90);
        body.AddArc(27, 17, 14, 14, 270, 90);
        body.AddArc(27, 33, 14, 14, 0, 90);
        body.AddArc(5, 33, 14, 14, 90, 90);
        body.CloseFigure();
        return body;
    }

    private static GraphicsPath CameraLens()
    {
        var lens = new GraphicsPath();
        lens.AddPolygon(new[] { new PointF(39, 25), new PointF(58, 16), new PointF(58, 48), new PointF(39, 39) });
        return lens;
    }

    private static void DrawCamera(Graphics drawing, float x, float y, float size)
    {
        var state = drawing.Save();
        drawing.TranslateTransform(x, y);
        drawing.ScaleTransform(size / 64, size / 64);
        drawing.SmoothingMode = SmoothingMode.AntiAlias;
        using (var body = CameraBody())
        using (var lens = CameraLens())
        using (var fill = new SolidBrush(DarkGreen))
        using (var green = new SolidBrush(Green))
        using (var amber = new SolidBrush(Amber))
        using (var outline = new Pen(Green, OutlineWidth))
        {
            outline.LineJoin = LineJoin.Round;
            drawing.FillPath(green, lens);
            drawing.DrawPath(outline, lens);
            drawing.FillPath(fill, body);
            drawing.DrawPath(outline, body);
            drawing.FillEllipse(amber, DotX, DotY, DotSize, DotSize);
            outline.Width = LineWidth;
            outline.StartCap = outline.EndCap = LineCap.Round;
            drawing.DrawLine(outline, LineX1, LineY, LineX2, LineY);
        }
        drawing.Restore(state);
    }

    private static string SvgPath(GraphicsPath path)
    {
        var points = path.PathPoints;
        var types = path.PathTypes;
        var result = new StringBuilder();
        int bezierPoint = 0;
        for (int i = 0; i < points.Length; i++)
        {
            int type = types[i] & 7;
            if (type == 3)
            {
                result.Append(bezierPoint % 3 == 0 ? " C " : " ");
                bezierPoint++;
            }
            else
            {
                bezierPoint = 0;
                result.Append(type == 0 ? "M " : " L ");
            }
            result.Append(points[i].X.ToString("0.###", CultureInfo.InvariantCulture));
            result.Append(' ');
            result.Append(points[i].Y.ToString("0.###", CultureInfo.InvariantCulture));
            if ((types[i] & 0x80) != 0) result.Append(" Z");
        }
        return result.ToString();
    }

    private static string SvgColor(Color color)
    {
        return String.Format(CultureInfo.InvariantCulture, "#{0:x2}{1:x2}{2:x2}", color.R, color.G, color.B);
    }

    private static void WriteSvg(string path)
    {
        using (var body = CameraBody())
        using (var lens = CameraLens())
        {
            string svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n" +
                "  <path d=\"" + SvgPath(lens) + "\" fill=\"" + SvgColor(Green) + "\" stroke=\"" + SvgColor(Green) + "\" stroke-width=\"" + OutlineWidth + "\" stroke-linejoin=\"round\"/>\n" +
                "  <path d=\"" + SvgPath(body) + "\" fill=\"" + SvgColor(DarkGreen) + "\" stroke=\"" + SvgColor(Green) + "\" stroke-width=\"" + OutlineWidth + "\" stroke-linejoin=\"round\"/>\n" +
                String.Format(CultureInfo.InvariantCulture, "  <circle cx=\"{0}\" cy=\"{1}\" r=\"{2}\" fill=\"{3}\"/>\n", DotX + DotSize / 2.0, DotY + DotSize / 2.0, DotSize / 2.0, SvgColor(Amber)) +
                String.Format(CultureInfo.InvariantCulture, "  <path d=\"M {0} {2} L {1} {2}\" stroke=\"{3}\" stroke-width=\"{4}\" stroke-linecap=\"round\"/>\n</svg>\n", LineX1, LineX2, LineY, SvgColor(Green), LineWidth);
            File.WriteAllText(path, svg, new UTF8Encoding(false));
        }
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
        WriteSvg(Path.Combine(directory, "camera.svg"));
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
