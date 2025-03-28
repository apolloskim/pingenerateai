import { sampleFunction } from '@src/sampleFunction';

console.log('content script loaded');

// Shows how to call a function defined in another module
sampleFunction();

// Function to add or remove highlight from images
function toggleImageHighlight(element: HTMLElement | SVGElement, highlight: boolean) {
  if (highlight) {
    element.style.outline = '3px solid #4285f4';
    element.style.outlineOffset = '2px';
    element.style.boxShadow = '0 0 10px rgba(66, 133, 244, 0.6)';
    element.style.transition = 'all 0.3s ease';
    element.style.zIndex = '9999'; // Ensure highlighted element is on top
    // Store reference to currently highlighted element
    window.__highlightedElement = element;
  } else {
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.boxShadow = '';
    element.style.zIndex = ''; // Reset z-index
    if (window.__highlightedElement === element) {
      window.__highlightedElement = null;
    }
  }
}

// Function to extract image data from different types of elements
function getImageFromElement(element: HTMLElement | SVGElement): string | null {
  // Case 1: Regular <img> tag
  if (element.tagName === 'IMG') {
    return (element as HTMLImageElement).src;
  }

  // Case 2: Background image
  const bgImage = window.getComputedStyle(element).backgroundImage;
  if (bgImage && bgImage !== 'none') {
    // Extract URL from "url('...')" format
    const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
    return match ? match[1] : null;
  }

  // Case 3: SVG element
  if (element.tagName === 'svg') {
    const svgData = new XMLSerializer().serializeToString(element);
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }

  // Case 4: Canvas element
  if (element.tagName === 'CANVAS') {
    return (element as HTMLCanvasElement).toDataURL();
  }

  // Case 5: Pinterest specific - find nested image
  const nestedImg = element.querySelector('img');
  if (nestedImg) {
    return (nestedImg as HTMLImageElement).src;
  }

  // Case 6: Picture element with source
  if (element.tagName === 'PICTURE') {
    const img = element.querySelector('img');
    if (img) {
      return (img as HTMLImageElement).src;
    }

    const source = element.querySelector('source');
    if (source) {
      return source.srcset?.split(' ')[0] || null;
    }
  }

  // Case 7: Try to find data-src or similar attributes (lazy loaded images)
  if (element instanceof HTMLElement) {
    const dataSrc =
      element.getAttribute('data-src') ||
      element.getAttribute('data-original') ||
      element.getAttribute('data-lazy-src');
    if (dataSrc) {
      return dataSrc;
    }
  }

  return null;
}

// Find all possible image elements
function findAllImageElements() {
  // Track unique elements with images
  const imageElements = new Set<HTMLElement | SVGElement>();

  // 1. Find standard <img> tags
  document.querySelectorAll('img').forEach(img => {
    imageElements.add(img);
  });

  // 2. Find elements with background images
  document.querySelectorAll('*').forEach(el => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return;

    const style = window.getComputedStyle(el);
    if (style.backgroundImage && style.backgroundImage !== 'none' && !style.backgroundImage.includes('gradient')) {
      imageElements.add(el);
    }
  });

  // 3. Find SVG elements
  document.querySelectorAll('svg').forEach(svg => {
    imageElements.add(svg);
  });

  // 4. Find canvas elements
  document.querySelectorAll('canvas').forEach(canvas => {
    imageElements.add(canvas);
  });

  // 5. Find picture elements (commonly used in responsive designs)
  document.querySelectorAll('picture').forEach(picture => {
    imageElements.add(picture);
  });

  // 6. Find Pinterest specific image containers
  document.querySelectorAll('[data-test-id="pinrep-image"]').forEach(el => {
    if (el instanceof HTMLElement) {
      imageElements.add(el);
    }
  });

  // 7. Pinterest specific - find pins
  document.querySelectorAll('[data-test-pin-id]').forEach(el => {
    if (el instanceof HTMLElement) {
      imageElements.add(el);
    }
  });

  // 8. Find elements with aria-label containing "image" or similar
  document.querySelectorAll('[aria-label*="image" i], [aria-label*="photo" i], [alt]').forEach(el => {
    if (el instanceof HTMLElement && !imageElements.has(el)) {
      const hasImage = getImageFromElement(el) !== null;
      if (hasImage) {
        imageElements.add(el);
      }
    }
  });

  // 9. Find large div blocks that might be image containers
  document.querySelectorAll('div').forEach(div => {
    if (imageElements.has(div)) return;

    const rect = div.getBoundingClientRect();
    // Only consider reasonably sized elements that might be images
    if (rect.width > 100 && rect.height > 100 && rect.width < 1000 && rect.height < 1000) {
      const style = window.getComputedStyle(div);
      // No text content and has children
      if (!div.textContent?.trim() && div.children.length > 0) {
        // Check for nested image
        const img = div.querySelector('img');
        if (img) {
          imageElements.add(div);
        }
      }
    }
  });

  console.log(`Found ${imageElements.size} total image elements`);
  return Array.from(imageElements);
}

// Set up highlighting for all image elements
function setupImageHighlighting() {
  const imageElements = findAllImageElements();

  imageElements.forEach(element => {
    // Skip if already has event listeners to prevent duplicates
    if (element.hasAttribute('data-highlight-initialized')) return;

    // Mark as initialized
    element.setAttribute('data-highlight-initialized', 'true');

    // Add highlighting on hover
    element.addEventListener('mouseenter', () => {
      // Only highlight if we can extract an image from it
      if (getImageFromElement(element)) {
        toggleImageHighlight(element, true);
      }
    });

    element.addEventListener('mouseleave', () => {
      toggleImageHighlight(element, false);
    });
  });
}

// MutationObserver to handle dynamically added images
function setupMutationObserver() {
  const observer = new MutationObserver(mutations => {
    let newElements = false;

    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        newElements = true;
      }
    });

    // If new elements were added, scan for new images
    if (newElements) {
      setTimeout(() => {
        setupImageHighlighting();
      }, 100);
    }
  });

  // Observe entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'data-src', 'srcset'],
  });
}

// Register the content script is ready to receive messages
function registerContentScriptReady() {
  try {
    chrome.runtime.sendMessage({ action: 'contentScriptReady' }, response => {
      // Check for runtime.lastError to avoid uncaught error
      if (chrome.runtime.lastError) {
        console.log('Error registering content script:', chrome.runtime.lastError.message);
        // Not a critical error, we can continue
        return;
      }
    });
  } catch (error) {
    console.error('Failed to send ready message:', error);
    // Not a critical error, we can continue
  }
}

// Handle messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'copyToClipboard') {
    const imageUrl = message.imageUrl;
    if (imageUrl) {
      copyImageToClipboard(imageUrl)
        .then(success => {
          sendResponse({ success });
        })
        .catch(error => {
          console.error('Error copying to clipboard:', error);
          sendResponse({ success: false, error: String(error) });
        });
      return true; // Keep connection open for async response
    }
  }

  // Handle keyboard shortcut triggered from background script
  if (message.action === 'processImageShortcut') {
    // Simulate Alt+Z by calling the same function as the keyboard shortcut
    const highlightedElement = window.__highlightedElement;
    if (!highlightedElement) {
      showToast('No image selected', 'error');
      return false;
    }

    const imageUrl = getImageFromElement(highlightedElement);
    if (!imageUrl) {
      showToast('Failed to extract image', 'error');
      return false;
    }

    // Store active element to restore focus later
    const activeElement = document.activeElement;

    // Create a hidden input to help maintain focus during clipboard operations
    const focusHelper = document.createElement('input');
    focusHelper.style.position = 'fixed';
    focusHelper.style.opacity = '0';
    focusHelper.style.pointerEvents = 'none';
    focusHelper.style.left = '-9999px';
    document.body.appendChild(focusHelper);

    // Focus our helper to ensure document has focus
    focusHelper.focus();

    // Process the image
    showToast('Copying image...', 'info');
    urlToDataURL(imageUrl)
      .then(dataUrl => {
        // Record document focus state before clipboard operation
        console.log('Document has focus before clipboard operation:', document.hasFocus());
        return copyImageToClipboard(dataUrl);
      })
      .then(result => {
        // Clean up focus helper
        document.body.removeChild(focusHelper);

        // Restore original focus if possible
        if (activeElement instanceof HTMLElement) {
          try {
            activeElement.focus();
          } catch (focusError) {
            console.log('Could not restore focus:', focusError);
          }
        }

        if (result) {
          showToast('Image copied to clipboard!', 'success');
        } else {
          showToast('Failed to copy image', 'error');
        }
      })
      .catch(error => {
        // Clean up focus helper on error
        if (document.body.contains(focusHelper)) {
          document.body.removeChild(focusHelper);
        }

        console.error('Error processing image:', error);
        showToast('Error processing image', 'error');
      });

    return false;
  }

  return false;
});

// Set up keyboard shortcut handler for copying images
function setupKeyboardShortcut() {
  document.addEventListener('keydown', async event => {
    // Check for Alt+Z (Option+Z on Mac)
    if (event.altKey && event.key === 'z') {
      console.log('Keyboard shortcut Alt+Z detected!');
      event.preventDefault(); // Prevent any default browser actions

      // Get currently highlighted element
      const highlightedElement = window.__highlightedElement;
      if (!highlightedElement) {
        console.log('No image is currently highlighted - hover over an image first');
        showToast('No image selected', 'error');
        return;
      }

      // Get image from element
      const imageUrl = getImageFromElement(highlightedElement);
      if (!imageUrl) {
        console.log('Could not extract image from highlighted element');
        showToast('Failed to extract image', 'error');
        return;
      }

      // Show copying toast (immediate feedback)
      showToast('Copying image...', 'info');

      try {
        // Convert URL to DataURL (using our existing function)
        const dataUrl = await urlToDataURL(imageUrl);

        // Use the Clipboard API to copy the image
        const success = await copyImageToClipboard(dataUrl);

        // Show success/failure message
        if (success) {
          showToast('Image copied to clipboard!', 'success');
        } else {
          showToast('Failed to copy image', 'error');
        }
      } catch (error) {
        console.error('Error processing image:', error);
        showToast('Error processing image', 'error');
      }
    }
  });
}

// Simple toast notification
function showToast(message: string, type: 'success' | 'error' | 'info') {
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
  }, 2000);
}

// Convert a URL to a data URL
async function urlToDataURL(url: string): Promise<string> {
  // If it's already a data URL, return it directly
  if (url.startsWith('data:')) {
    return url;
  }

  // For same-origin images or images that support CORS
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Fetch failed with status: ${response.status}`);
    }
    const blob = await response.blob();
    return await blobToDataURL(blob);
  } catch (error) {
    console.log('Direct fetch failed, trying background script...');

    try {
      return await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ action: 'fetchImage', imageUrl: url }, response => {
            if (chrome.runtime.lastError) {
              console.error('Error in fetchImage message:', chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            if (response && response.success && response.dataUrl) {
              resolve(response.dataUrl);
            } else {
              reject(new Error(response?.error || 'Background fetch failed'));
            }
          });
        } catch (sendError) {
          console.error('Error sending fetchImage message:', sendError);
          reject(new Error('Failed to send message to background script'));
        }
      });
    } catch (bgError) {
      console.log('Background fetch failed, trying img element as last resort:', bgError);

      // Fallback for cross-origin images: using an image element
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Try to request CORS access

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Could not get canvas context'));
              return;
            }

            ctx.drawImage(img, 0, 0);

            // Get data URL
            const dataURL = canvas.toDataURL('image/png');
            resolve(dataURL);
          } catch (e) {
            reject(e);
          }
        };

        img.onerror = e => {
          reject(new Error('Could not load image: ' + String(e)));
        };

        // Make sure we don't fetch from cache to avoid CORS issues
        img.src = url + (url.includes('?') ? '&' : '?') + 'cachebuster=' + Date.now();
      });
    }
  }
}

// Helper function to convert Blob to data URL
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Copy image to clipboard using direct Clipboard API with blob
async function copyImageToClipboard(dataURL: string): Promise<boolean> {
  console.log('Starting direct clipboard operation');

  try {
    // Force conversion to PNG format which has better clipboard support
    const pngDataUrl = await convertToPng(dataURL);

    // Convert data URL to blob
    const fetchResponse = await fetch(pngDataUrl);
    const blob = await fetchResponse.blob();

    // Always use image/png mime type
    const mimeType = 'image/png';

    // Check if Clipboard API is available
    if (!navigator.clipboard || !window.ClipboardItem) {
      throw new Error('Clipboard API not available');
    }

    // Create a ClipboardItem with the image blob
    const clipboardItem = new ClipboardItem({
      [mimeType]: blob,
    });

    // Write to clipboard
    await navigator.clipboard.write([clipboardItem]);
    console.log('Successfully copied image to clipboard with Clipboard API');
    return true;
  } catch (error) {
    console.error('Clipboard API failed:', error);

    // Fallback to execCommand approach
    try {
      // Create a temporary image
      const tempImg = document.createElement('img');
      tempImg.src = dataURL;
      tempImg.style.position = 'absolute';
      tempImg.style.left = '-9999px';
      tempImg.style.top = '-9999px';
      document.body.appendChild(tempImg);

      // Wait for the image to load
      await new Promise(resolve => {
        tempImg.onload = resolve;
      });

      // Select and copy
      const range = document.createRange();
      range.selectNode(tempImg);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const success = document.execCommand('copy');

      // Clean up
      selection?.removeAllRanges();
      document.body.removeChild(tempImg);

      console.log('Fallback copy method result:', success);
      return success;
    } catch (fallbackError) {
      console.error('All clipboard methods failed:', fallbackError);

      // Last resort: Try background script clipboard access
      try {
        return await new Promise(resolve => {
          chrome.runtime.sendMessage(
            {
              action: 'writeImageToClipboard',
              imageDataUrl: dataURL,
            },
            response => {
              if (chrome.runtime.lastError) {
                console.error('Background clipboard failed:', chrome.runtime.lastError.message);
                resolve(false);
                return;
              }

              resolve(!!response?.success);
            },
          );
        });
      } catch (bgError) {
        console.error('Background clipboard access failed:', bgError);
        return false;
      }
    }
  }
}

// Helper function to ensure image is in PNG format
async function convertToPng(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        // Create canvas with same dimensions as image
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // Draw image to canvas
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Use white background for transparent images
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the image
        ctx.drawImage(img, 0, 0);

        // Get PNG data URL
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = e => {
      reject(new Error('Could not load image for PNG conversion: ' + String(e)));
    };

    img.src = dataUrl;
  });
}

// Initialize with retry mechanism for lazy-loaded content
function initialize() {
  setupImageHighlighting();
  setupMutationObserver();
  setupKeyboardShortcut();
  registerContentScriptReady();

  // Additional scans for lazy-loaded content
  const retryIntervals = [1000, 3000, 5000, 10000];
  retryIntervals.forEach(interval => {
    setTimeout(setupImageHighlighting, interval);
  });

  // For sites like Pinterest, add scroll-based scanning
  let scrollTimer: number | null = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
    }
    scrollTimer = window.setTimeout(() => {
      setupImageHighlighting();
    }, 300) as unknown as number;
  });
}

// Initialize on window load and DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - initializing extension');
    initialize();
  });
} else {
  console.log('Document already loaded - initializing extension immediately');
  initialize();
}

// Also ensure we initialize on window load in case DOMContentLoaded was missed
window.addEventListener('load', () => {
  console.log('Window loaded - ensuring extension is initialized');
  // Add a slight delay to ensure all scripts are fully loaded
  setTimeout(initialize, 100);
});

// Add TypeScript interface augmentation
declare global {
  interface Window {
    __highlightedElement: HTMLElement | SVGElement | null;
    ClipboardItem?: any; // Add ClipboardItem as optional to avoid type errors
  }
}
