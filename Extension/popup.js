function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['userId'], function(result) {
      resolve(result.userId || 'sha');
    });
  });
}

function setUserId(userId) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({userId: userId}, function() {
      resolve();
    });
  });
}

// Function to submit a new automation
async function submitAutomation(automationText) {
  const userId = await getUserId();
  try {
    const response = await fetch('https://brassworker.sharan-goku19.workers.dev/store-automation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ automationText, userId }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to store automation');
    }

    const result = await response.json();
    console.log('Automation processed:', result);

    // Clear cache for the current domain
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({action: "clearCacheForPage"}, function(response) {
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error('Failed to clear cache'));
        }
      });
    });

    return 'Automation submitted successfully!';
  } catch (error) {
    console.error('Error processing automation:', error);
    throw new Error(`Error processing automation: ${error.message}`);
  }
}


// Function to fetch and display automation results
function displayAutomationResults() {
  chrome.runtime.sendMessage({action: "getAutomationResults"}, function(response) {
    const resultsElement = document.getElementById('automationResults');
    if (response && response.html && response.html !== 'none') {
      resultsElement.innerHTML = response.html;
    } else {
      resultsElement.innerHTML = '<p>No relevant automations found for this page.</p>';
    }
  });
}

// Event listener for DOMContentLoaded
document.addEventListener('DOMContentLoaded', async function() {
  const userIdInput = document.getElementById('userId');
  userIdInput.value = await getUserId();

  userIdInput.addEventListener('change', async () => {
    await setUserId(userIdInput.value);
  });
  
  // Display automation results when popup opens
  displayAutomationResults();

  // Set up event listener for the submit button
  const submitButton = document.getElementById('submitAutomation');
  const automationInput = document.getElementById('automationInput');

  submitButton.addEventListener('click', async () => {
    const automationText = automationInput.value.trim();
    if (automationText) {
      submitButton.disabled = true;
      try {
        const message = await submitAutomation(automationText);
        alert(message);
        automationInput.value = '';
        // Refresh the displayed results after submission
        displayAutomationResults();
      } catch (error) {
        alert(error.message);
      } finally {
        submitButton.disabled = false;
      }
    } else {
      alert('Please enter an automation description.');
    }
  });
});