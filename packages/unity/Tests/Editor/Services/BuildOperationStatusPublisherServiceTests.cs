using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Tests.Utilities;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationStatusPublisherServiceTests
    {
        private string jobGuid;
        private BuildJobDefinition job;

        [SetUp]
        public void SetUp()
        {
            BuildStatusEventBus.SetUseDelayCall(false);
            jobGuid = EditorThreadTestHelper.GenerateTestJobGuid();
            job = new BuildJobDefinition("test-profile-guid")
            {
                JobGuid = jobGuid,
                Status = BuildJobStatus.Queued,
                StatusDetail = string.Empty
            };

            BuildQueueRuntimeState.Instance.Reset();
            BuildQueueRuntimeState.Instance.ActiveJobGuid = jobGuid;
        }

        [TearDown]
        public void TearDown()
        {
            BuildStatusEventBus.UnsubscribeAllFromJob(jobGuid);
            BuildStatusEventBus.SetUseDelayCall(true);
            BuildQueueRuntimeState.Instance.Reset();
        }

        [Test]
        public void PublishIfChanged_UpdatesJobRuntimeStateAndPublishesEvent()
        {
            string received = null;
            BuildStatusEventBus.SubscribeToJob(jobGuid, status => received = status);

            var service = new BuildOperationStatusPublisherService(job);
            service.PublishIfChanged("Synchronizing workspace files (10%).");

            Assert.AreEqual("Synchronizing workspace files (10%).", job.StatusDetail);
            Assert.AreEqual("Synchronizing workspace files (10%).", BuildQueueRuntimeState.Instance.ActiveStatusText);
            Assert.AreEqual("Synchronizing workspace files (10%).", received);
        }

        [Test]
        public void PublishIfChanged_DeduplicatesRepeatedStatus()
        {
            int count = 0;
            BuildStatusEventBus.SubscribeToJob(jobGuid, _ => count++);

            var service = new BuildOperationStatusPublisherService(job);
            service.PublishIfChanged("Executing Unity build process.");
            service.PublishIfChanged("Executing Unity build process.");

            Assert.AreEqual(1, count);
        }

        [Test]
        public void RegisterActiveJobTracking_UpdatesStatusWhenEventBusPublishes()
        {
            BuildOperationStatusPublisherService.RegisterActiveJobTracking(job);

            BuildStatusEventBus.PublishStatusChange(jobGuid, "Tracking update");

            Assert.AreEqual("Tracking update", job.StatusDetail);
            Assert.AreEqual("Tracking update", BuildQueueRuntimeState.Instance.ActiveStatusText);
        }

        [Test]
        public void PublishIfChanged_TrackingTextRemainsCompatibleAcrossProAndLiteContracts()
        {
            var service = new BuildOperationStatusPublisherService(job);
            service.PublishIfChanged("Checking workspace sync status...");

            Assert.AreEqual("Checking workspace sync status...", job.StatusDetail);
        }
    }
}
