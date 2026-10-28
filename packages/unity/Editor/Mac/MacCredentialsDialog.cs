using UnityEngine;
using UnityEditor;

namespace Covyne.CADET.Editor.Mac
{
    /// <summary>
    /// Custom dialog window for macOS credentials input
    /// </summary>
    public class MacCredentialsDialog : EditorWindow
    {
        private static string result = null;
        private static bool isOpen = false;
        
        private string inputText = "";
        private string messageText = "";
        
        public static string Show(string title, string message)
        {
            if (isOpen)
            {
                // Dialog already open, return
                return null;
            }
            
            result = null;
            isOpen = true;
            
            MacCredentialsDialog window = CreateInstance<MacCredentialsDialog>();
            window.messageText = message;
            window.inputText = "";
            window.titleContent = new GUIContent(title);
            window.minSize = new Vector2(380, 220);
            window.maxSize = new Vector2(380, 220);
            window.ShowModalUtility();
            
            isOpen = false;
            return result;
        }
        
        private void OnGUI()
        {
            EditorGUILayout.Space(10);
            
            // Display message using HelpBox for better formatting
            // Replace literal \n with actual newlines
            string formattedMessage = messageText.Replace("\\n", "\n");
            EditorGUILayout.HelpBox(formattedMessage, MessageType.Info);
            
            EditorGUILayout.Space(15);
            
            // Password input field (wider)
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Password:", GUILayout.Width(80));
            GUI.SetNextControlName("PasswordField");
            inputText = EditorGUILayout.TextField(inputText, GUILayout.ExpandWidth(true));
            EditorGUILayout.EndHorizontal();
            
            // Focus the password field on first draw
            if (Event.current.type == EventType.Layout)
            {
                EditorGUI.FocusTextInControl("PasswordField");
            }
            
            EditorGUILayout.Space(10);
            
            // Buttons
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            
            if (GUILayout.Button("Cancel", GUILayout.Width(100)))
            {
                result = null;
                Close();
            }
            
            if (GUILayout.Button("OK", GUILayout.Width(100)))
            {
                result = inputText?.Trim();
                Close();
            }
            
            EditorGUILayout.EndHorizontal();
            
            // Handle Enter key
            if (Event.current.type == EventType.KeyDown)
            {
                if (Event.current.keyCode == KeyCode.Return || Event.current.keyCode == KeyCode.KeypadEnter)
                {
                    result = inputText?.Trim();
                    Close();
                    Event.current.Use();
                }
                else if (Event.current.keyCode == KeyCode.Escape)
                {
                    result = null;
                    Close();
                    Event.current.Use();
                }
            }
        }
    }
}
