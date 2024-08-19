const WORKER_URL = 'https://brassworker.sharan-goku19.workers.dev';
let cachedResults = {};

async function processPage(tabId, url, title) {
  try {
    // Check if the tab still exists
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      console.log(`Tab ${tabId} no longer exists. Skipping processing.`);
      return;
    }

    const [{ result: pageContent }] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => document.body.innerText
    });

    const userId = await getUserId();

    const response = await fetch(`${WORKER_URL}/get-automation-results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        pageContent: `Domain: ${new URL(url).hostname}\nTitle: ${title}\n\nContent:\n${pageContent.slice(0, 5000)}`,
        domain: new URL(url).hostname, 
        title,
        userId 
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to process webpage: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    cachedResults[url] = result.data;

    if (result.data && result.data.html && result.data.html !== 'none') {
      chrome.action.setPopup({ tabId: tabId, popup: 'popup.html' });
      try {
        await chrome.action.openPopup();
      } catch (error) {
        console.log('Failed to open popup automatically:', error);
      }
    }
  } catch (error) {
    console.error('Error processing page:', error);
  }
}


async function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['userId'], function(result) {
      resolve(result.userId || 'sha');
    });
  });
}



chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    if (cachedResults[tab.url]) {
      chrome.action.setPopup({ tabId: tabId, popup: 'popup.html' });
      try {
        await chrome.action.openPopup();
      } catch (error) {
        console.log('Failed to open popup automatically:', error);
      }
    } else {
      await processPage(tabId, tab.url, tab.title);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAutomationResults") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0] && tabs[0].url) {
        if (cachedResults[tabs[0].url]) {
          sendResponse(cachedResults[tabs[0].url]);
        } else {
          sendResponse({html: 'none'});
        }
      } else {
        sendResponse({html: 'none'});
      }
    });
    return true;  // Indicates that the response is sent asynchronously
  } else if (request.action === "clearCacheForPage") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0] && tabs[0].url) {
        delete cachedResults[tabs[0].url];
        sendResponse({success: true});
      } else {
        sendResponse({success: false});
      }
    });
    return true;
  }
});