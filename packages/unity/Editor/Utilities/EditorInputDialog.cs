using UnityEngine;
using UnityEditor;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Simple input dialog for Unity Editor
    /// </summary>
    public class EditorInputDialog : EditorWindow
    {
        private static string result = null;
        private static bool isOpen = false;
        
        private string inputText = "";
        private string message = "";
        
        public static string Show(string title, string message, string defaultValue = "")
        {
            if (isOpen)
            {
                // Dialog already open, return null
                return null;
            }
            
            result = null;
            isOpen = true;
            
            var window = CreateInstance<EditorInputDialog>();
            window.titleContent = new GUIContent(title);
            window.message = message;
            window.inputText = defaultValue;
            window.minSize = new Vector2(400, 120);
            window.maxSize = new Vector2(400, 120);
            window.ShowModalUtility();
            
            isOpen = false;
            return result;
        }
        
        private void OnGUI()
        {
            EditorGUILayout.Space(10);
            
            if (!string.IsNullOrEmpty(message))
            {
                EditorGUILayout.LabelField(message, EditorStyles.wordWrappedLabel);
            }
            
            EditorGUILayout.Space(5);
            
            GUI.SetNextControlName("InputField");
            inputText = EditorGUILayout.TextField(inputText);
            
            // Focus the text field on first draw
            if (Event.current.type == EventType.Layout)
            {
                EditorGUI.FocusTextInControl("InputField");
            }
            
            EditorGUILayout.Space(10);
            
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            
            if (GUILayout.Button("Cancel", GUILayout.Width(80)))
            {
                result = null;
                Close();
            }
            
            if (GUILayout.Button("OK", GUILayout.Width(80)))
            {
                result = inputText?.Trim();
                Close();
            }
            
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
            
            EditorGUILayout.EndHorizontal();
        }
    }
}

