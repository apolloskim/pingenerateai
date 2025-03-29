import 'webextension-polyfill';

// Keep track of tabs that have the content script ready
const contentScriptReadyTabs = new Set<number>();

console.log('Background loaded');

// Listen for command shortcuts
chrome.commands.onCommand.addListener(command => {
  if (command === 'send-image-to-ai') {
    // Simply forward the command to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs.length > 0 && tabs[0].id) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'processImageShortcut' }, response => {
            // Check for runtime.lastError to prevent uncaught errors
            if (chrome.runtime.lastError) {
              console.log('Could not send message to tab:', chrome.runtime.lastError.message);
              // Tab might not have content script loaded - show notification or take alternative action
            }
          });
        } catch (error) {
          console.error('Error sending message to tab:', error);
        }
      }
    });
  } else if (command === 'toggle-image-panel') {
    // Toggle the visibility of the image queue panel
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs.length > 0 && tabs[0].id) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleImagePanel' }, response => {
            // Check for runtime.lastError to prevent uncaught errors
            if (chrome.runtime.lastError) {
              console.log('Could not send message to tab:', chrome.runtime.lastError.message);
              // Tab might not have content script loaded
            }
          });
        } catch (error) {
          console.error('Error sending message to tab:', error);
        }
      }
    });
  }
});

// Handle tab cleanup
chrome.tabs.onRemoved.addListener(tabId => {
  // Remove tab from the ready set when it's closed
  if (contentScriptReadyTabs.has(tabId)) {
    contentScriptReadyTabs.delete(tabId);
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Track content script ready status
  if (message.action === 'contentScriptReady') {
    if (sender.tab?.id) {
      contentScriptReadyTabs.add(sender.tab.id);
      console.log('Content script ready in tab:', sender.tab.id);
    }
    return false;
  }

  // Removed the writeImageToClipboard handler - copying now happens solely in the content script

  // Handle image fetching (for bypassing CORS)
  if (message.action === 'fetchImage') {
    // Background script can fetch any URL without CORS restrictions
    try {
      fetch(message.imageUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
          }
          return response.blob();
        })
        .then(blob => {
          // Convert blob to data URL
          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              sendResponse({
                success: true,
                dataUrl: reader.result,
              });
            } catch (responseError) {
              console.error('Error sending successful response:', responseError);
            }
          };
          reader.onerror = () => {
            try {
              sendResponse({
                success: false,
                error: 'Failed to convert blob to data URL',
              });
            } catch (responseError) {
              console.error('Error sending error response:', responseError);
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch(error => {
          console.error('Error fetching image:', error);
          try {
            sendResponse({
              success: false,
              error: error.message,
            });
          } catch (responseError) {
            console.error('Error sending error response:', responseError);
          }
        });
    } catch (error) {
      console.error('Error in fetchImage handler:', error);
      try {
        sendResponse({
          success: false,
          error: 'Internal extension error',
        });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }

    return true; // Keep message channel open for async response
  }

  return false;
});

// Helper function to convert data URL to Blob
function dataURLtoBlob(dataUrl: string): Blob {
  try {
    // Convert base64 to raw binary data held in a string
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new Blob([u8arr], { type: mime });
  } catch (err) {
    console.error('Error converting data URL to blob:', err);
    return new Blob([], { type: 'image/png' });
  }
}
