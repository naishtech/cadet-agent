namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Result type for credential validation
    /// </summary>
    public enum ValidationResultType
    {
        Success,
        InvalidCredentials,
        RequiresGuardCode,
        ConnectionFailed
    }
}

