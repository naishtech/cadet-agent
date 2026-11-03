using NUnit.Framework;
using System.Collections;
using UnityEngine.TestTools;
using UnityEngine.Events;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Tests.Utilities;

namespace Covyne.CADET.Editor.Tests.Models
{
    /// <summary>
    /// Tests for BuildJobDefinition event integration.
    /// Verifies that the job definition properly manages status change events.
    /// </summary>
    [TestFixture]
    public class BuildJobDefinitionEventTests
    {
        private BuildJobDefinition testJob;

        [SetUp]
        public void Setup()
        {
            // Disable delayCall for immediate callback execution during test
            BuildStatusEventBus.SetUseDelayCall(false);
            
            testJob = new BuildJobDefinition("test-profile-guid")
            {
                Status = BuildJobStatus.Queued
            };
        }

        [TearDown]
        public void TearDown()
        {
            // Re-enable delayCall for normal operation
            BuildStatusEventBus.SetUseDelayCall(true);
            
            // Always clean up subscriptions after each test
            if (testJob != null)
            {
                BuildStatusEventBus.UnsubscribeAllFromJob(testJob.JobGuid);
            }
        }

        /// <summary>
        /// Test 6: BuildJobDefinition_Creates_OnStatusChanged_Event
        /// Verifies that OnStatusChanged UnityEvent is properly initialized on the job.
        /// </summary>
        [Test]
        public void BuildJobDefinition_Creates_OnStatusChanged_Event()
        {
            Assert.IsNotNull(testJob.OnStatusChanged, "OnStatusChanged event should be initialized");
            Assert.IsInstanceOf<UnityEvent<string>>(testJob.OnStatusChanged, "OnStatusChanged should be a UnityEvent<string>");
        }

        /// <summary>
        /// Test 7: BuildJobDefinition_JobGuid_Registered_With_EventBus
        /// Verifies that a job can be linked to the event bus for status updates.
        /// This ensures the job's GUID is properly usable with the event bus system.
        /// </summary>
        [Test]
        public void BuildJobDefinition_JobGuid_Registered_With_EventBus()
        {
            string receivedStatus = null;

            // Subscribe via event bus using job's GUID
            BuildStatusEventBus.SubscribeToJob(testJob.JobGuid, status =>
            {
                receivedStatus = status;
            });

            // Publish via event bus
            BuildStatusEventBus.PublishStatusChange(testJob.JobGuid, "Test Status");

            // With SetUseDelayCall(false), callback executes immediately
            Assert.AreEqual("Test Status", receivedStatus, "Job GUID should be properly linked to event bus");
        }
    }
}
