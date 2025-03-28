// ChatGPT Helper functionality

// QueuedImage type definition from main extension
interface QueuedImage {
  id: string;
  dataUrl: string;
  sourceUrl: string;
  timestamp: number;
  thumbnailUrl?: string;
}

// New function called by content script after successful copy
export function pasteIntoChatGPT() {
  // We just call pasteImageWithTemplate without any template text.
  // It assumes the image is now on the clipboard.
  pasteImageWithTemplate('');
}

// Set up ChatGPT paste helper button
export function setupChatGPTPasteHelper() {
  // Check if we're on ChatGPT
  if (!(window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com'))) {
    return;
  }

  // Check if button already exists
  if (document.getElementById('chatgpt-paste-helper')) {
    return;
  }

  console.log('Setting up ChatGPT paste helper button');

  // Create the main container
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.bottom = '10px';
  container.style.right = '10px';
  container.style.zIndex = '9999';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'flex-end';
  container.style.gap = '10px';
  container.style.padding = '10px';

  // Create the templates dropdown
  const templateContainer = document.createElement('div');
  templateContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  templateContainer.style.borderRadius = '8px';
  templateContainer.style.padding = '15px';
  templateContainer.style.color = 'white';
  templateContainer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
  templateContainer.style.display = 'none'; // Initially hidden
  templateContainer.style.flexDirection = 'column';
  templateContainer.style.gap = '10px';
  templateContainer.style.maxWidth = '300px';

  // Add template header
  const templateHeader = document.createElement('div');
  templateHeader.textContent = 'Select Paste Template';
  templateHeader.style.fontWeight = 'bold';
  templateHeader.style.marginBottom = '10px';
  templateContainer.appendChild(templateHeader);

  // Add template options
  const templates = [
    { name: 'Default', value: 'Please describe this image:' },
    { name: 'Detailed Analysis', value: 'Please provide a detailed analysis of this image:' },
    { name: 'Just Image', value: '' },
  ];

  templates.forEach(template => {
    const option = document.createElement('div');
    option.textContent = `${template.name}${template.value ? ': ' + template.value : ''}`;
    option.style.padding = '8px';
    option.style.cursor = 'pointer';
    option.style.borderRadius = '4px';
    option.style.transition = 'background-color 0.2s';

    option.addEventListener('mouseenter', () => {
      option.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });

    option.addEventListener('mouseleave', () => {
      option.style.backgroundColor = 'transparent';
    });

    option.addEventListener('click', () => {
      pasteImageWithTemplate(template.value);
      templateContainer.style.display = 'none';
    });

    templateContainer.appendChild(option);
  });

  // Create custom template input
  const customTemplateContainer = document.createElement('div');
  customTemplateContainer.style.display = 'flex';
  customTemplateContainer.style.gap = '8px';
  customTemplateContainer.style.marginTop = '10px';

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = 'Custom template...';
  customInput.style.flex = '1';
  customInput.style.padding = '8px';
  customInput.style.borderRadius = '4px';
  customInput.style.border = '1px solid rgba(255, 255, 255, 0.3)';
  customInput.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
  customInput.style.color = 'white';

  const applyButton = document.createElement('button');
  applyButton.textContent = 'Apply';
  applyButton.style.padding = '8px 12px';
  applyButton.style.backgroundColor = '#3B82F6';
  applyButton.style.border = 'none';
  applyButton.style.borderRadius = '4px';
  applyButton.style.color = 'white';
  applyButton.style.cursor = 'pointer';

  applyButton.addEventListener('click', () => {
    if (customInput.value) {
      pasteImageWithTemplate(customInput.value);
      templateContainer.style.display = 'none';
    }
  });

  customTemplateContainer.appendChild(customInput);
  customTemplateContainer.appendChild(applyButton);
  templateContainer.appendChild(customTemplateContainer);

  // Add event listeners for clipboard detection
  document.addEventListener('paste', e => {
    // Could add clipboard detection here if needed
  });

  // Add components to the DOM
  container.appendChild(templateContainer);
  document.body.appendChild(container);

  // Now that we've set up the UI helper, update it when image is copied
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.imageQueue) {
      const newImageQueue = changes.imageQueue.newValue;
      if (newImageQueue && newImageQueue.length > 0) {
        console.log('New image detected in queue on ChatGPT page.');
        // Note: We don't need to show buttons anymore, as pasting will be automatic
      }
    }
  });
}

// Refined function to paste the image with optional template text
// Assumes image is ALREADY on the clipboard
async function pasteImageWithTemplate(templateText: string) {
  try {
    // Find ChatGPT input
    const promptTextarea =
      document.getElementById('prompt-textarea') ||
      document.querySelector<HTMLElement>('[data-id="prompt-textarea"]') || // More specific type
      document.querySelector<HTMLElement>('[contenteditable="true"].ProseMirror'); // More specific type

    if (!promptTextarea) {
      showToast('ChatGPT input not found', 'error');
      console.error('ChatGPT input area not found.');
      return;
    }

    // Ensure the textarea is focused BEFORE attempting to paste
    promptTextarea.focus();

    // If template text, insert it first
    // Clear existing content before inserting template? Decide based on desired UX.
    // Here we prepend the template text + newlines.
    if (templateText) {
      // Create a consistent way to insert text, handling both textarea and contenteditable
      const currentContent =
        promptTextarea.tagName === 'TEXTAREA'
          ? (promptTextarea as HTMLTextAreaElement).value
          : promptTextarea.innerText; // Use innerText for contenteditable

      const newContent = templateText + '\n\n' + currentContent; // Prepend template

      if (promptTextarea.tagName === 'TEXTAREA') {
        (promptTextarea as HTMLTextAreaElement).value = templateText + '\n\n'; // Clear and set for textarea is simpler for paste
        (promptTextarea as HTMLTextAreaElement).selectionStart = (promptTextarea as HTMLTextAreaElement).value.length; // Move cursor to end
        (promptTextarea as HTMLTextAreaElement).selectionEnd = (promptTextarea as HTMLTextAreaElement).value.length;
      } else if (promptTextarea.isContentEditable) {
        // For contenteditable, inserting text and maintaining cursor/selection is complex.
        // Simplest approach for pasting *after* text: just set the text.
        // A more robust solution might involve Range and Selection APIs.
        promptTextarea.innerText = templateText + '\n\n'; // Overwrite for simplicity before paste
        // Try to move cursor to the end (might not work perfectly in all editors)
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(promptTextarea);
        range.collapse(false); // Collapse to the end
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      // Dispatch input event to potentially trigger ChatGPT's UI updates
      promptTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

      // Add a small delay after inserting text before pasting image
      await new Promise(resolve => setTimeout(resolve, 50));
      promptTextarea.focus(); // Re-focus just in case
    }

    // Trigger paste using execCommand
    console.log('Attempting execCommand("paste")... Document focused:', document.hasFocus());
    let pasteSuccess = false;
    try {
      // execCommand is deprecated but still the most common way to programmatically paste
      pasteSuccess = document.execCommand('paste');
    } catch (e) {
      console.error('execCommand("paste") threw an error:', e);
      pasteSuccess = false;
    }

    if (pasteSuccess) {
      showToast('Paste command issued!', 'success'); // More accurate toast
      console.log('execCommand("paste") returned true.');
      // Note: execCommand returning true doesn't guarantee the paste *content* was valid,
      // but it means the command itself didn't immediately fail.
    } else {
      showToast('Auto-paste failed. Press Ctrl+V / Cmd+V', 'info', 5000);
      console.error('execCommand("paste") returned false or threw an error. Clipboard might be empty or focus lost.');
    }
  } catch (error) {
    console.error('Error in pasteImageWithTemplate:', error);
    showToast('Error during paste attempt', 'error');
  }
}

// Check if we're on ChatGPT and set up helper on page load
export function checkIfChatGPTAndSetupHelper() {
  if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) {
    console.log('ChatGPT detected, setting up paste helper');
    setupChatGPTPasteHelper();

    // Check if we have a currentImage param in the URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('pasteImage')) {
      // Give the page a moment to initialize
      setTimeout(() => {
        // Show the paste helper prominently
        showToast('Click the paste button to insert your image', 'info', 5000);
      }, 1000);
    }
  }
}

// Simple toast notification
export function showToast(message: string, type: 'success' | 'error' | 'info', duration = 2000) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '4px';
  toast.style.fontSize = '14px';
  toast.style.fontFamily = 'system-ui, sans-serif';
  toast.style.zIndex = '10000';
  toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  toast.style.minWidth = '200px';
  toast.style.textAlign = 'center';

  if (type === 'success') {
    toast.style.backgroundColor = '#4caf50';
    toast.style.color = 'white';
  } else if (type === 'error') {
    toast.style.backgroundColor = '#f44336';
    toast.style.color = 'white';
  } else {
    toast.style.backgroundColor = '#2196f3';
    toast.style.color = 'white';
  }

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 500);
  }, duration);
}
