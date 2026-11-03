using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.ViewModels
{
    [TestFixture]
    public class CadetWindowCoordinatorTests
    {
        [Test]
        public void OnProfileSelected_LogsAndInvalidatesAllDependentState()
        {
            int buildExistenceUpdates = 0;
            int platformAvailabilityUpdates = 0;
            int cosmosAvailabilityUpdates = 0;
            int dependencyChecks = 0;
            int repaints = 0;
            string lastLoggedProfile = null;

            var coordinator = new CadetWindowCoordinator(
                () => buildExistenceUpdates++,
                () => platformAvailabilityUpdates++,
                () => cosmosAvailabilityUpdates++,
                () => dependencyChecks++,
                () => repaints++);

            coordinator.OnProfileSelected("Profile-A", value => lastLoggedProfile = value);

            Assert.AreEqual("Profile-A", lastLoggedProfile);
            Assert.AreEqual(1, buildExistenceUpdates);
            Assert.AreEqual(1, platformAvailabilityUpdates);
            Assert.AreEqual(1, cosmosAvailabilityUpdates);
            Assert.AreEqual(1, dependencyChecks);
            Assert.AreEqual(1, repaints);
        }

        [Test]
        public void OnProfileConfigurationChanged_InvalidatesAllDependentState()
        {
            int buildExistenceUpdates = 0;
            int platformAvailabilityUpdates = 0;
            int cosmosAvailabilityUpdates = 0;
            int dependencyChecks = 0;
            int repaints = 0;

            var coordinator = new CadetWindowCoordinator(
                () => buildExistenceUpdates++,
                () => platformAvailabilityUpdates++,
                () => cosmosAvailabilityUpdates++,
                () => dependencyChecks++,
                () => repaints++);

            coordinator.OnProfileConfigurationChanged();

            Assert.AreEqual(1, buildExistenceUpdates);
            Assert.AreEqual(1, platformAvailabilityUpdates);
            Assert.AreEqual(1, cosmosAvailabilityUpdates);
            Assert.AreEqual(1, dependencyChecks);
            Assert.AreEqual(1, repaints);
        }

        [Test]
        public void OnMacCredentialsStateChanged_UpdatesBuildExistenceAndRepaintsOnly()
        {
            int buildExistenceUpdates = 0;
            int platformAvailabilityUpdates = 0;
            int cosmosAvailabilityUpdates = 0;
            int dependencyChecks = 0;
            int repaints = 0;

            var coordinator = new CadetWindowCoordinator(
                () => buildExistenceUpdates++,
                () => platformAvailabilityUpdates++,
                () => cosmosAvailabilityUpdates++,
                () => dependencyChecks++,
                () => repaints++);

            coordinator.OnMacCredentialsStateChanged();

            Assert.AreEqual(1, buildExistenceUpdates);
            Assert.AreEqual(0, platformAvailabilityUpdates);
            Assert.AreEqual(0, cosmosAvailabilityUpdates);
            Assert.AreEqual(0, dependencyChecks);
            Assert.AreEqual(1, repaints);
        }

        [Test]
        public void OnProfileSelected_WithNullLogger_StillInvalidatesAllDependentState()
        {
            int buildExistenceUpdates = 0;
            int platformAvailabilityUpdates = 0;
            int cosmosAvailabilityUpdates = 0;
            int dependencyChecks = 0;
            int repaints = 0;

            var coordinator = new CadetWindowCoordinator(
                () => buildExistenceUpdates++,
                () => platformAvailabilityUpdates++,
                () => cosmosAvailabilityUpdates++,
                () => dependencyChecks++,
                () => repaints++);

            coordinator.OnProfileSelected("Profile-B", null);

            Assert.AreEqual(1, buildExistenceUpdates);
            Assert.AreEqual(1, platformAvailabilityUpdates);
            Assert.AreEqual(1, cosmosAvailabilityUpdates);
            Assert.AreEqual(1, dependencyChecks);
            Assert.AreEqual(1, repaints);
        }
    }
}
