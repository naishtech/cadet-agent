using Covyne.CADET.Editor.Lite.Models;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueRenderHelperService
    {
        public static string GetStatusIcon(BuildJobStatus status)
        {
            return status switch
            {
                BuildJobStatus.Queued => "⏳",
                BuildJobStatus.Syncing => "📁",
                BuildJobStatus.Building => "🔨",
#if !CADET_LITE
                BuildJobStatus.Publishing => "🚀",
                BuildJobStatus.Notarizing => "✍️",
#endif
                BuildJobStatus.Completed => "✅",
                BuildJobStatus.Failed => "❌",
                BuildJobStatus.Cancelled => "⛔",
                _ => "❓"
            };
        }

        public static void DrawActivitySquares(
            Rect statusRect,
            float squaresWidth,
            int squareCount,
            float squareSize,
            float squareSpacing,
            Color squareColor,
            Texture2D whiteTexture)
        {
            float time = (float)EditorApplication.timeSinceStartup;
            float pulseSpeed = 2f;
            float cycleOffset = 2f * Mathf.PI / squareCount;

            float startX = statusRect.x + statusRect.width - squaresWidth;
            float squareY = statusRect.y + (statusRect.height - squareSize) / 2f;

            for (int i = 0; i < squareCount; i++)
            {
                float squareX = startX + i * (squareSize + squareSpacing);
                Rect squareRect = new Rect(squareX, squareY, squareSize, squareSize);

                float phaseOffset = i * cycleOffset;
                float pulse = (Mathf.Sin(time * pulseSpeed * Mathf.PI + phaseOffset) + 1f) / 2f;
                Color fillColor = new Color(squareColor.r, squareColor.g, squareColor.b, pulse);
                DrawRect(squareRect, fillColor, whiteTexture);
            }
        }

        public static void DrawRect(Rect rect, Color color, Texture2D whiteTexture)
        {
            if (whiteTexture == null)
            {
                return;
            }

            Color oldColor = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, whiteTexture);
            GUI.color = oldColor;
        }
    }
}
