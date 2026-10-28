using System;
using System.Collections;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine.TestTools;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Tests.Utilities;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// Tests for BuildStatusEventBus service.
    /// Verifies event routing, threading marshalling, and subscription/unsubscription behavior.
    /// </summary>
    [TestFixture]
    public class BuildStatusEventBusTests
    {
        private string testJobGuid;

        [SetUp]
        public void Setup()
        {
            testJobGuid = EditorThreadTestHelper.GenerateTestJobGuid();
            // Disable delayCall for faster tests (callbacks execute immediately)
            BuildStatusEventBus.SetUseDelayCall(false);
        }

        [TearDown]
        public void Teardown()
        {
            // Restore delayCall to disabled state for clean tests
            BuildStatusEventBus.SetUseDelayCall(false);
            
            // Clear all subscriptions after each test
            BuildStatusEventBus.UnsubscribeAllFromJob(testJobGuid);
        }

        /// <summary>
        /// Test 2: SubscribeToJob_Receives_Status_Updates
        /// Verifies that subscribed callbacks receive published status updates.
        /// </summary>
        [Test]
        public void SubscribeToJob_Receives_Status_Updates()
        {
            string receivedStatus = null;

            BuildStatusEventBus.SubscribeToJob(testJobGuid, status =>
            {
                receivedStatus = status;
            });

            BuildStatusEventBus.PublishStatusChange(testJobGuid, "Status A");

            Assert.AreEqual("Status A", receivedStatus, "Callback should receive published status");
        }

        /// <summary>
        /// Test 3: UnsubscribeFromJob_Stops_Receiving_Updates
        /// Verifies that unsubscribed callbacks no longer receive updates.
        /// </summary>
        [Test]
        public void UnsubscribeFromJob_Stops_Receiving_Updates()
        {
            int callCount = 0;

            Action<string> callback = status => callCount++;

            BuildStatusEventBus.SubscribeToJob(testJobGuid, callback);
            BuildStatusEventBus.PublishStatusChange(testJobGuid, "First");

            Assert.AreEqual(1, callCount, "First publish should trigger callback");

            BuildStatusEventBus.UnsubscribeFromJob(testJobGuid, callback);
            BuildStatusEventBus.PublishStatusChange(testJobGuid, "Second");

            Assert.AreEqual(1, callCount, "After unsubscribe, callback should not be invoked");
        }

        /// <summary>
        /// Test 4: Multiple_Subscribers_All_Receive_Same_Event
        /// Verifies that multiple subscribers all receive the same status update.
        /// </summary>
        [Test]
        public void Multiple_Subscribers_All_Receive_Same_Event()
        {
            string status1 = null;
            string status2 = null;

            BuildStatusEventBus.SubscribeToJob(testJobGuid, status => status1 = status);
            BuildStatusEventBus.SubscribeToJob(testJobGuid, status => status2 = status);

            BuildStatusEventBus.PublishStatusChange(testJobGuid, "Shared Status");

            Assert.AreEqual("Shared Status", status1, "First subscriber should receive status");
            Assert.AreEqual("Shared Status", status2, "Second subscriber should receive same status");
        }

        /// <summary>
        /// Test 5: UnsubscribeAllFromJob_Clears_All_Subscribers
        /// Verifies that unsubscribing all listeners for a job prevents any further notifications.
        /// </summary>
        [Test]
        public void UnsubscribeAllFromJob_Clears_All_Subscribers()
        {
            int callCount1 = 0;
            int callCount2 = 0;
            int callCount3 = 0;

            BuildStatusEventBus.SubscribeToJob(testJobGuid, status => callCount1++);
            BuildStatusEventBus.SubscribeToJob(testJobGuid, status => callCount2++);
            BuildStatusEventBus.SubscribeToJob(testJobGuid, status => callCount3++);

            BuildStatusEventBus.PublishStatusChange(testJobGuid, "First");
            Assert.AreEqual(1, callCount1, "All subscribers should receive first publish");
            Assert.AreEqual(1, callCount2);
            Assert.AreEqual(1, callCount3);

            BuildStatusEventBus.UnsubscribeAllFromJob(testJobGuid);
            BuildStatusEventBus.PublishStatusChange(testJobGuid, "Second");

            Assert.AreEqual(1, callCount1, "After clear, no callback should be invoked");
            Assert.AreEqual(1, callCount2);
            Assert.AreEqual(1, callCount3);
        }
    }
}
