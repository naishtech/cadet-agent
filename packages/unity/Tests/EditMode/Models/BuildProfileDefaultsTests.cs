using Covyne.CADET.Editor.Models;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Models
{
    [TestFixture]
    public class BuildProfileDefaultsTests
    {
        [Test]
        public void Constructor_SetsEditionSpecificPlatformDefault()
        {
            var profile = new BuildProfile();

#if CADET_LITE
            Assert.AreEqual("none", profile.platform);
#else
            Assert.AreEqual("steam", profile.platform);
#endif
        }
    }
}
