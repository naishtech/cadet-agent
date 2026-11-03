using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for status indicator based on ProgressBarViewModel
    /// </summary>
    public class ProgressBarView
    {
        private ProgressBarViewModel viewModel;
        private EditorWindow parentWindow;
        private static Texture2D whiteTexture;
        private bool isSubscribedToUpdate = false;
        
        // Pulsating squares settings
        private const float SQUARE_SIZE = 8f;
        private const float SQUARE_SPACING = 4f;
        private const float OUTLINE_WIDTH = 1f;
        private const int SQUARE_COUNT = 3;
        private static readonly Color GREEN_COLOR = new Color(0.2f, 0.8f, 0.2f, 1f);
        private static readonly Color OUTLINE_COLOR = Color.black;
        private static readonly Color SUCCESS_GREEN = new Color(0.2f, 0.7f, 0.2f, 1f);
        private static Texture2D checkmarkIcon;
        
        public ProgressBarView(ProgressBarViewModel viewModel, EditorWindow parentWindow)
        {
            this.viewModel = viewModel;
            this.parentWindow = parentWindow;
            
            // Subscribe to ViewModel events
            viewModel.ModeChanged += (mode) => RepaintIfNeeded();
            viewModel.ProgressChanged += (progress) => RepaintIfNeeded();
            viewModel.StatusTextChanged += (status) => RepaintIfNeeded();
            viewModel.IsRunningChanged += (running) => OnRunningStateChanged(running);
            
            // Create white texture for drawing
            if (whiteTexture == null)
            {
                whiteTexture = new Texture2D(1, 1);
                whiteTexture.SetPixel(0, 0, Color.white);
                whiteTexture.Apply();
            }
        }
        
        private void OnRunningStateChanged(bool isRunning)
        {
            if (isRunning && !isSubscribedToUpdate)
            {
                // Subscribe to EditorApplication.update for continuous repaints during animation
                EditorApplication.update += OnEditorUpdate;
                isSubscribedToUpdate = true;
            }
            else if (!isRunning && isSubscribedToUpdate)
            {
                // Unsubscribe when not running
                EditorApplication.update -= OnEditorUpdate;
                isSubscribedToUpdate = false;
            }
            RepaintIfNeeded();
        }
        
        private void OnEditorUpdate()
        {
            // Only repaint if still running
            if (viewModel.IsRunning)
            {
                RepaintIfNeeded();
            }
            else
            {
                // Clean up if state changed
                if (isSubscribedToUpdate)
                {
                    EditorApplication.update -= OnEditorUpdate;
                    isSubscribedToUpdate = false;
                }
            }
        }
        
        public void Draw()
        {
            // Show status indicator if running OR if there's an error/success to display
            if (viewModel.Mode == ProgressMode.None && !viewModel.IsRunning && !viewModel.HasError && !viewModel.HasSuccess)
                return;
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            // If there's an error but not running, just show the error message
            if (viewModel.HasError && !viewModel.IsRunning)
            {
                EditorGUILayout.HelpBox(viewModel.StatusText, MessageType.Error);
            }
            // If there's a success message but not running, show the success message
            else if (viewModel.HasSuccess && !viewModel.IsRunning)
            {
                DrawSuccessHelpBox(viewModel.StatusText);
            }
            else
            {
                // Use GetRect for precise layout control to prevent text clipping
                Rect horizontalRect = EditorGUILayout.GetControlRect(false, EditorGUIUtility.singleLineHeight);
                
                float buttonWidth = viewModel.IsRunning && viewModel.CanCancel ? 60f : 0f;
                float squaresWidth = viewModel.IsRunning ? (SQUARE_SIZE * SQUARE_COUNT + SQUARE_SPACING * (SQUARE_COUNT - 1) + 10f) : 0f;
                float spacing = buttonWidth > 0 ? 5f : 0f;
                float textWidth = horizontalRect.width - buttonWidth - squaresWidth - spacing;
                
                // Draw text
                if (!string.IsNullOrEmpty(viewModel.StatusText))
                {
                    Rect textRect = new Rect(horizontalRect.x, horizontalRect.y, textWidth, horizontalRect.height);
                    GUI.Label(textRect, viewModel.StatusText);
                }
                
                // Draw pulsating squares when running
                if (viewModel.IsRunning)
                {
                    DrawPulsatingSquares(horizontalRect, buttonWidth);
                }
                
                // Draw cancel button
                if (viewModel.IsRunning && viewModel.CanCancel)
                {
                    Rect buttonRect = new Rect(horizontalRect.x + horizontalRect.width - buttonWidth, horizontalRect.y, buttonWidth, horizontalRect.height);
                    if (GUI.Button(buttonRect, CadetLocalization.GetString("Window.Cadet.Buttons.Cancel")))
                    {
                        viewModel.RequestCancel();
                    }
                }
                
                // Display error message if there's an error (while running)
                if (viewModel.HasError && !string.IsNullOrEmpty(viewModel.StatusText))
                {
                    EditorGUILayout.Space(5);
                    EditorGUILayout.HelpBox(viewModel.StatusText, MessageType.Error);
                }
            }
            
            EditorGUILayout.EndVertical();
        }
        
        private void DrawPulsatingSquares(Rect horizontalRect, float buttonWidth)
        {
            // Calculate pulse value (0 to 1) using sine wave
            float time = (float)EditorApplication.timeSinceStartup;
            float pulseSpeed = 2f;
            float cycleOffset = 2f * Mathf.PI / SQUARE_COUNT; // 1/3 cycle offset (120 degrees)
            
            // Position squares on the far right (before cancel button if present)
            float squaresStartX = horizontalRect.x + horizontalRect.width - buttonWidth - (buttonWidth > 0 ? 5f : 0f) - (SQUARE_SIZE * SQUARE_COUNT + SQUARE_SPACING * (SQUARE_COUNT - 1));
            float squareY = horizontalRect.y + (horizontalRect.height - SQUARE_SIZE) / 2f;
            
            for (int i = 0; i < SQUARE_COUNT; i++)
            {
                float squareX = squaresStartX + i * (SQUARE_SIZE + SQUARE_SPACING);
                Rect squareRect = new Rect(squareX, squareY, SQUARE_SIZE, SQUARE_SIZE);
                
                // Calculate pulse with 1/3 cycle offset for each square
                float phaseOffset = i * cycleOffset;
                float pulse = (Mathf.Sin(time * pulseSpeed * Mathf.PI + phaseOffset) + 1f) / 2f; // 0 to 1
                
                // Draw black outline
                DrawRect(new Rect(squareRect.x - OUTLINE_WIDTH, squareRect.y - OUTLINE_WIDTH, 
                    squareRect.width + OUTLINE_WIDTH * 2, squareRect.height + OUTLINE_WIDTH * 2), OUTLINE_COLOR);
                
                // Draw green fill with pulsating alpha
                Color fillColor = new Color(GREEN_COLOR.r, GREEN_COLOR.g, GREEN_COLOR.b, pulse);
                DrawRect(squareRect, fillColor);
            }
        }
        
        private void DrawRect(Rect rect, Color color)
        {
            if (whiteTexture == null)
            {
                whiteTexture = new Texture2D(1, 1);
                whiteTexture.SetPixel(0, 0, Color.white);
                whiteTexture.Apply();
            }
            
            Color oldColor = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, whiteTexture);
            GUI.color = oldColor;
        }
        
        /// <summary>
        /// Draws a custom success HelpBox with a green checkmark icon, similar to Unity's HelpBox but styled for success
        /// </summary>
        private void DrawSuccessHelpBox(string message)
        {
            // Try to get a checkmark icon from Unity's built-in icons
            GUIContent iconContent = null;
            Texture2D icon = null;
            
            // Try various Unity icon names that might be checkmarks (prioritize Valid which is Unity's checkmark icon)
            string[] iconNames = { "Valid", "d_Valid", "Valid@2x", "Collab", "CollabNew", "winbtn_mac_max" };
            foreach (string iconName in iconNames)
            {
                iconContent = EditorGUIUtility.IconContent(iconName);
                if (iconContent != null && iconContent.image != null)
                {
                    icon = iconContent.image as Texture2D;
                    if (icon != null)
                        break;
                }
            }
            
            // If no icon found, create a simple checkmark texture
            if (icon == null)
            {
                icon = CreateCheckmarkIcon();
            }
            
            // Get the HelpBox style
            GUIStyle helpBoxStyle = EditorStyles.helpBox;
            
            // Calculate the message height
            GUIContent messageContent = new GUIContent(message);
            float messageHeight = helpBoxStyle.CalcHeight(messageContent, EditorGUIUtility.currentViewWidth - 40f);
            
            // Get the rect for the HelpBox
            Rect helpBoxRect = EditorGUILayout.GetControlRect(false, messageHeight + 8f);
            
            // Draw the HelpBox background (light green tint)
            Color oldColor = GUI.color;
            GUI.color = new Color(0.9f, 1f, 0.9f, 1f); // Light green background
            GUI.Box(helpBoxRect, GUIContent.none, helpBoxStyle);
            GUI.color = oldColor;
            
            // Draw the checkmark icon
            if (icon != null)
            {
                float iconSize = 16f;
                float iconPadding = 4f;
                Rect iconRect = new Rect(
                    helpBoxRect.x + iconPadding,
                    helpBoxRect.y + (helpBoxRect.height - iconSize) / 2f,
                    iconSize,
                    iconSize
                );
                
                // Draw icon with green tint
                Color oldIconColor = GUI.color;
                GUI.color = SUCCESS_GREEN;
                GUI.DrawTexture(iconRect, icon);
                GUI.color = oldIconColor;
            }
            
            // Draw the message text
            Rect textRect = new Rect(
                helpBoxRect.x + (icon != null ? 24f : 4f),
                helpBoxRect.y + 4f,
                helpBoxRect.width - (icon != null ? 28f : 8f),
                messageHeight
            );
            
            // Use a style that matches HelpBox text (default color, not green)
            GUIStyle textStyle = new GUIStyle(EditorStyles.label);
            textStyle.wordWrap = true;
            GUI.Label(textRect, message, textStyle);
        }
        
        /// <summary>
        /// Creates a simple checkmark icon texture
        /// </summary>
        private Texture2D CreateCheckmarkIcon()
        {
            if (checkmarkIcon != null)
                return checkmarkIcon;
            
            int size = 16;
            checkmarkIcon = new Texture2D(size, size, TextureFormat.RGBA32, false);
            
            // Clear the texture
            Color[] pixels = new Color[size * size];
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = Color.clear;
            }
            
            // Draw a checkmark shape: two lines forming a check
            // Left vertical line: x=4, y from 5 to 9
            for (int y = 5; y <= 9; y++)
            {
                int index = y * size + 4;
                if (index < pixels.Length)
                {
                    pixels[index] = SUCCESS_GREEN;
                    // Make it slightly thicker
                    if (3 < size && (y * size + 3) < pixels.Length)
                        pixels[y * size + 3] = SUCCESS_GREEN;
                    if (5 < size && (y * size + 5) < pixels.Length)
                        pixels[y * size + 5] = SUCCESS_GREEN;
                }
            }
            
            // Bottom horizontal line: y=9, x from 4 to 7
            for (int x = 4; x <= 7; x++)
            {
                int index = 9 * size + x;
                if (index < pixels.Length)
                {
                    pixels[index] = SUCCESS_GREEN;
                    // Make it slightly thicker
                    if ((8 * size + x) < pixels.Length)
                        pixels[8 * size + x] = SUCCESS_GREEN;
                    if ((10 * size + x) < pixels.Length)
                        pixels[10 * size + x] = SUCCESS_GREEN;
                }
            }
            
            // Diagonal line from (7,9) going up-right to (12,4)
            for (int i = 0; i <= 5; i++)
            {
                int x = 7 + i;
                int y = 9 - i;
                if (x < size && y >= 0 && y < size)
                {
                    int index = y * size + x;
                    if (index < pixels.Length)
                    {
                        pixels[index] = SUCCESS_GREEN;
                        // Make diagonal slightly thicker
                        if (x + 1 < size && (y * size + x + 1) < pixels.Length)
                            pixels[y * size + x + 1] = SUCCESS_GREEN;
                        if (x - 1 >= 0 && (y * size + x - 1) < pixels.Length)
                            pixels[y * size + x - 1] = SUCCESS_GREEN;
                    }
                }
            }
            
            checkmarkIcon.SetPixels(pixels);
            checkmarkIcon.Apply();
            
            return checkmarkIcon;
        }
        
        private void RepaintIfNeeded()
        {
            // Repaint the parent window to show smooth animation
            if (parentWindow != null)
            {
                parentWindow.Repaint();
            }
        }
    }
}

