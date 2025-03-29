import { sampleFunction } from '@src/sampleFunction';
import { checkIfChatGPTAndSetupHelper, showToast, pasteIntoChatGPT } from './chatgpt-helper';

console.log('content script loaded');

// Shows how to call a function defined in another module
sampleFunction();

// Function to add or remove highlight from images
function toggleImageHighlight(element: HTMLElement | SVGElement, highlight: boolean) {
  if (highlight) {
    element.style.outline = '3px solid #000000';
    element.style.outlineOffset = '2px';
    element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.6)';
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
  // Handle keyboard shortcut triggered from background script (ensure it calls the same logic as direct keydown)
  if (message.action === 'processImageShortcut') {
    // Simulate the Alt+Z keydown event logic
    const highlightedElement = window.__highlightedElement;
    if (!highlightedElement) {
      showToast('No image selected. Hover over an image.', 'error');
      return false;
    }

    const imageUrl = getImageFromElement(highlightedElement);
    if (!imageUrl) {
      showToast('Failed to extract image source.', 'error');
      return false;
    }

    // --- Focus Helper ---
    // Store active element to restore focus later
    const activeElement = document.activeElement;
    const focusHelper = document.createElement('input');
    focusHelper.style.position = 'fixed';
    focusHelper.style.opacity = '0';
    focusHelper.style.pointerEvents = 'none';
    focusHelper.style.left = '-9999px';
    document.body.appendChild(focusHelper);
    focusHelper.focus(); // Attempt to ensure document focus
    // --- End Focus Helper ---

    showToast('Processing image...', 'info', 1000); // Shorter duration

    (async () => {
      try {
        const dataUrl = await urlToDataURL(imageUrl);
        console.log('Document has focus before copy attempt:', document.hasFocus()); // Log focus state
        const copySuccess = await copyImageToClipboard(dataUrl);

        if (copySuccess) {
          showToast('Image copied!', 'success');
          await addImageToQueue(dataUrl, imageUrl); // Add to queue on success

          // Check if on ChatGPT and attempt paste
          const hostname = window.location.hostname;
          if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
            console.log('Detected ChatGPT site, attempting paste...');
            // Use a minimal delay, relying on user focus potentially being maintained
            setTimeout(() => pasteIntoChatGPT(), 100);
          }
        }
        // No "else" here, copyImageToClipboard shows its own error toast
      } catch (error) {
        console.error('Error processing image shortcut:', error);
        showToast('Error processing image', 'error');
      } finally {
        // --- Restore Focus ---
        if (document.body.contains(focusHelper)) {
          document.body.removeChild(focusHelper);
        }
        // Try to restore original focus
        if (activeElement instanceof HTMLElement) {
          try {
            // Small delay before restoring focus, might help in some cases
            setTimeout(() => activeElement.focus({ preventScroll: true }), 50);
          } catch (focusError) {
            console.warn('Could not restore focus:', focusError);
          }
        }
        // --- End Restore Focus ---
      }
    })();

    return false; // Indicate sync handling
  }

  return false; // Default for other messages
});

// Add type definitions for our image queue
interface QueuedImage {
  id: string;
  dataUrl: string;
  sourceUrl: string;
  timestamp: number;
  thumbnailUrl?: string;
  prompt?: string; // Associated prompt
}

// Add type for prompts
interface QueuedPrompt {
  id: string;
  text: string;
  timestamp: number;
  source?: string; // Where the prompt came from
}

// Constants
const MAX_QUEUE_SIZE = 20; // Store up to 20 recent images
const QUEUE_STORAGE_KEY = 'pingenerateai_image_queue';
const PROMPT_STORAGE_KEY = 'pingenerateai_prompt_queue';
const PANEL_POSITION_STORAGE_KEY = 'pingenerateai_panel_position';

// UI-related variables
let queuePanelVisible = false;
let queuePanel: HTMLElement | null = null;
let selectedImageId: string | null = null;
let selectedPromptId: string | null = null;
// Variables for drag functionality
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPanelX = 0;
let initialPanelY = 0;
let panelTranslateX = 0;
let panelTranslateY = 0;

// Add this function to create the queue visualization panel
function createQueuePanel(): HTMLElement {
  if (queuePanel) {
    return document.getElementById('pingenerateai-panel-container') as HTMLElement;
  }

  // Create panel container with shadow DOM
  const panelContainer = document.createElement('div');
  panelContainer.id = 'pingenerateai-panel-container';
  document.body.appendChild(panelContainer);
  const shadow = panelContainer.attachShadow({ mode: 'open' });

  // Get saved position from storage or use defaults
  let panelTop = 20;
  let panelLeft = 20;
  chrome.storage.local.get(PANEL_POSITION_STORAGE_KEY, result => {
    if (result[PANEL_POSITION_STORAGE_KEY]) {
      const savedPosition = result[PANEL_POSITION_STORAGE_KEY];
      if (savedPosition.top !== undefined && savedPosition.left !== undefined) {
        panelTop = savedPosition.top;
        panelLeft = savedPosition.left;

        // Update panel if it exists
        if (queuePanel) {
          queuePanel.style.top = `${panelTop}px`;
          queuePanel.style.left = `${panelLeft}px`;
        }
      }
    }
  });

  // Create panel element
  const panel = document.createElement('div');
  panel.className = 'panel-root';
  panel.style.display = queuePanelVisible ? 'flex' : 'none';
  panel.style.top = `${panelTop}px`;
  panel.style.left = `${panelLeft}px`;
  shadow.appendChild(panel);

  // Add click-outside handler to close the panel
  document.addEventListener('click', event => {
    // Only process if panel is visible
    if (!queuePanelVisible || !queuePanel) return;

    // Get the click target
    const target = event.target as Node;

    // Check if the click is outside the panel and outside the toggle button
    const toggleBtn = document.getElementById('pingenerateai-toggle-btn');

    // Use contains() to check if the panel's shadow root contains the clicked element
    // Note: Since shadow DOM is used, we need to check if the click is within the panel's host element
    if (
      panelContainer !== target &&
      !panelContainer.contains(target) &&
      toggleBtn !== target &&
      (toggleBtn ? !toggleBtn.contains(target) : true)
    ) {
      // If click is outside, hide the panel
      queuePanelVisible = false;
      panel.style.display = 'none';
      console.log('Panel closed via click-outside');
    }
  });

  // Define the style
  const style = document.createElement('style');
  style.textContent = `
    .panel-root {
      position: fixed;
      top: 20px;
      left: 20px;
      background-color: rgba(0, 0, 0, 0.85);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      color: white;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 999999;
      max-width: 700px;
      width: 700px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      will-change: transform; /* Hardware acceleration hint */
      transform: translate3d(0, 0, 0); /* Force hardware acceleration */
      transition: box-shadow 0.2s ease;
    }
    
    .panel-root.dragging {
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
      transition: none; /* Disable transitions while dragging */
    }
    
    .draggable {
      cursor: move;
      user-select: none;
    }
    
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .panel-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
    }
    
    .panel-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .refresh-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    
    .refresh-btn:hover {
      color: white;
      background-color: rgba(255, 255, 255, 0.1);
      transform: rotate(30deg);
    }
    
    .refresh-btn .refresh-icon {
      display: inline-block;
      width: 16px;
      height: 16px;
      color: white;
    }
    
    .panel-close {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      font-size: 18px;
      padding: 0 4px;
    }
    
    .panel-content {
      display: flex;
      flex: 1;
      min-height: 400px;
      max-height: 80vh;
    }
    
    .panel-section {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      position: relative;
    }
    
    .panel-section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      flex: 1;
    }
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    
    .section-refresh {
      margin-left: 8px;
    }
    
    .panel-section.images {
      border-right: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .panel-footer {
      padding: 12px 16px;
      display: flex;
      justify-content: flex-end;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .action-btn {
      background-color: #1a1a1a;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .action-btn:hover {
      background-color: #1a1a1a;
    }
    
    .action-btn:disabled {
      background-color: rgba(0, 0, 0, 0.5);
      cursor: not-allowed;
    }
    
    .secondary-btn {
      background-color: rgba(255, 255, 255, 0.1);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      margin-right: 8px;
    }
    
    .secondary-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    /* Image thumbnails styling */
    .thumbnail-container {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 8px;
    }
    
    .thumbnail {
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      aspect-ratio: 16/9;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 2px solid transparent;
    }
    
    .thumbnail:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    .thumbnail.selected {
      border-color: white;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
    }
    
    .thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .thumbnail .delete-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 1;
    }
    
    .thumbnail:hover .delete-btn {
      opacity: 1;
    }
    
    /* Prompt items styling */
    .prompt-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .prompt-item {
      position: relative;
      border-radius: 8px;
      padding: 12px;
      background-color: rgba(255, 255, 255, 0.05);
      cursor: pointer;
      transition: background-color 0.2s ease;
      border: 2px solid transparent;
    }
    
    .prompt-item:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    
    .prompt-item.selected {
      border-color: white;
      background-color: rgba(255, 255, 255, 0.15);
    }
    
    .prompt-text {
      margin: 0 0 8px 0;
      font-size: 14px;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    
    .prompt-meta {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
    }
    
    .prompt-item .delete-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    
    .prompt-item:hover .delete-btn {
      opacity: 1;
    }
    
    .empty-message {
      padding: 24px 0;
      text-align: center;
      color: rgba(255, 255, 255, 0.5);
      font-style: italic;
    }
    
    /* Prompt input styling */
    .prompt-input-container {
      margin-bottom: 16px;
    }
    
    .save-btn {
      background-color: #1a1a1a;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .save-btn:hover {
      background-color: #333333;
    }

    .selection-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      background-color: white;
      border-radius: 50%;
      margin-left: 5px;
    }
    
    /* Custom scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
    }
    
    ::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb {
      background-color: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background-color: rgba(255, 255, 255, 0.3);
    }
  `;
  shadow.appendChild(style);

  // Create panel header
  const header = document.createElement('div');
  header.className = 'panel-header draggable';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = 'PinGenerate AI';
  header.appendChild(title);

  // Create header actions container (refresh and close buttons)
  const headerActions = document.createElement('div');
  headerActions.className = 'panel-header-actions';

  // Add refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'refresh-btn';
  refreshBtn.title = 'Refresh panel content';
  refreshBtn.innerHTML = `
    <svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.453 12.6672C20.0582 16.4133 16.9138 19.4451 13.0909 19.4451C10.5058 19.4451 8.13405 18.1293 6.76304 16.1338M3.54708 11.3328C3.94185 7.58664 7.08622 4.55487 10.9091 4.55487C13.4942 4.55487 15.8659 5.87072 17.237 7.86615M16.9978 3.50023L17.7729 8.61372L12.6594 7.83868M7.00218 20.4998L6.22714 15.3863L11.3406 16.1613" 
        stroke="currentColor" 
        stroke-width="1.5" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
    </svg>
  `;

  refreshBtn.addEventListener('click', () => {
    // Create a simple rotation animation
    const icon = refreshBtn.querySelector('.refresh-icon');
    if (icon) {
      icon.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
        duration: 500,
        iterations: 1,
      });
    }

    // Refresh content
    refreshPanelContent();
  });

  headerActions.appendChild(refreshBtn);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'panel-close';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close panel';
  closeBtn.addEventListener('click', () => {
    queuePanelVisible = false;
    panel.style.display = 'none';
  });

  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);

  // Create panel content container
  const content = document.createElement('div');
  content.className = 'panel-content draggable';
  panel.appendChild(content);

  // Create panel sections
  const imagesSection = document.createElement('div');
  imagesSection.className = 'panel-section images draggable';

  const imagesSectionHeader = document.createElement('div');
  imagesSectionHeader.className = 'section-header draggable';
  imagesSection.appendChild(imagesSectionHeader);

  const imagesTitle = document.createElement('h3');
  imagesTitle.className = 'panel-section-title';
  imagesTitle.textContent = 'Recent Images';
  imagesSectionHeader.appendChild(imagesTitle);

  // Create refresh button for images
  const imagesRefreshBtn = document.createElement('button');
  imagesRefreshBtn.className = 'refresh-btn section-refresh';
  imagesRefreshBtn.title = 'Refresh images';
  imagesRefreshBtn.innerHTML = `
    <svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.453 12.6672C20.0582 16.4133 16.9138 19.4451 13.0909 19.4451C10.5058 19.4451 8.13405 18.1293 6.76304 16.1338M3.54708 11.3328C3.94185 7.58664 7.08622 4.55487 10.9091 4.55487C13.4942 4.55487 15.8659 5.87072 17.237 7.86615M16.9978 3.50023L17.7729 8.61372L12.6594 7.83868M7.00218 20.4998L6.22714 15.3863L11.3406 16.1613" 
        stroke="currentColor" 
        stroke-width="1.5" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
    </svg>
  `;

  imagesRefreshBtn.addEventListener('click', () => {
    showToast('Refreshing images...', 'info');
    updateImageContent(imagesContent);
  });
  imagesSectionHeader.appendChild(imagesRefreshBtn);

  // Create images content
  const imagesContent = document.createElement('div');
  imagesContent.className = 'images-content';
  updateImageContent(imagesContent);
  imagesSection.appendChild(imagesContent);

  const promptsSection = document.createElement('div');
  promptsSection.className = 'panel-section prompts draggable';

  const promptsSectionHeader = document.createElement('div');
  promptsSectionHeader.className = 'section-header draggable';
  promptsSection.appendChild(promptsSectionHeader);

  const promptsTitle = document.createElement('h3');
  promptsTitle.className = 'panel-section-title';
  promptsTitle.textContent = 'Saved Prompts';
  promptsSectionHeader.appendChild(promptsTitle);

  // Create refresh button for prompts
  const promptsRefreshBtn = document.createElement('button');
  promptsRefreshBtn.className = 'refresh-btn section-refresh';
  promptsRefreshBtn.title = 'Refresh prompts';
  promptsRefreshBtn.innerHTML = `
    <svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.453 12.6672C20.0582 16.4133 16.9138 19.4451 13.0909 19.4451C10.5058 19.4451 8.13405 18.1293 6.76304 16.1338M3.54708 11.3328C3.94185 7.58664 7.08622 4.55487 10.9091 4.55487C13.4942 4.55487 15.8659 5.87072 17.237 7.86615M16.9978 3.50023L17.7729 8.61372L12.6594 7.83868M7.00218 20.4998L6.22714 15.3863L11.3406 16.1613" 
        stroke="currentColor" 
        stroke-width="1.5" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
    </svg>
  `;

  promptsRefreshBtn.addEventListener('click', () => {
    showToast('Refreshing prompts...', 'info');
    updatePromptContent(promptsContent);
  });
  promptsSectionHeader.appendChild(promptsRefreshBtn);

  // Create prompts content
  const promptsContent = document.createElement('div');
  promptsContent.className = 'prompts-content';
  updatePromptContent(promptsContent);
  promptsSection.appendChild(promptsContent);

  content.appendChild(imagesSection);
  content.appendChild(promptsSection);

  // Create the panel footer
  const footer = document.createElement('div');
  footer.className = 'panel-footer draggable';

  const pasteBtn = document.createElement('button');
  pasteBtn.className = 'action-btn';
  pasteBtn.innerHTML = '<span>Paste</span>';
  pasteBtn.title = 'Paste selected items';
  pasteBtn.disabled = true; // Disabled until selection
  pasteBtn.addEventListener('click', pasteSelectedItem);

  footer.appendChild(pasteBtn);
  panel.appendChild(footer);

  // Initial content update
  updateImageContent(imagesContent);
  updatePromptContent(promptsContent);

  // Listen for selection changes to update button state
  document.addEventListener('selection-changed', updateFooterButtons);

  // Create a toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'pingenerateai-toggle-btn';
  toggleBtn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="white" stroke-width="12">
      <circle cx="100" cy="100" r="80" />
      <line x1="60" y1="30" x2="60" y2="170" stroke="white" stroke-width="12" />
      <line x1="60" y1="100" x2="140" y2="30" stroke="white" stroke-width="12" />
    </svg>
  `;
  toggleBtn.title = 'Toggle PinGenerate AI panel';
  toggleBtn.style.position = 'fixed';
  toggleBtn.style.bottom = '20px';
  toggleBtn.style.right = '20px';
  toggleBtn.style.width = '48px';
  toggleBtn.style.height = '48px';
  toggleBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
  toggleBtn.style.color = 'white';
  toggleBtn.style.border = 'none';
  toggleBtn.style.borderRadius = '50%';
  toggleBtn.style.fontSize = '20px';
  toggleBtn.style.display = 'flex';
  toggleBtn.style.alignItems = 'center';
  toggleBtn.style.justifyContent = 'center';
  toggleBtn.style.cursor = 'pointer';
  toggleBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
  toggleBtn.style.zIndex = '999998';
  toggleBtn.style.padding = '0';
  toggleBtn.addEventListener('click', toggleQueuePanel);
  shadow.appendChild(toggleBtn);

  // Add event listeners for dragging the panel
  const setupDraggable = (element: HTMLElement, isDraggableArea = true) => {
    if (isDraggableArea) {
      element.classList.add('draggable');
    }

    element.addEventListener('mousedown', e => {
      // Skip if clicking an interactive element (button, input, etc)
      const target = e.target as HTMLElement;
      const isInteractiveElement =
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'IMG' ||
        target.closest('.thumbnail') !== null ||
        target.closest('.prompt-item') !== null ||
        target.closest('.refresh-btn') !== null ||
        target.closest('.panel-close') !== null;

      // Don't start drag if clicking on an interactive element
      if (isInteractiveElement) return;

      // Start dragging
      isDragging = true;
      queuePanel?.classList.add('dragging');

      // Get panel position
      const rect = panel.getBoundingClientRect();
      initialPanelX = rect.left;
      initialPanelY = rect.top;

      // Get initial mouse position
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      // Add move and up event listeners to the document
      document.addEventListener('mousemove', handleDragMove, { capture: true });
      document.addEventListener('mouseup', handleDragEnd, { capture: true });

      // Prevent default behavior and bubbling
      e.preventDefault();
      e.stopPropagation();
    });
  };

  // Make header draggable
  setupDraggable(header);

  // Make footer draggable
  setupDraggable(footer);

  // Make content draggable
  setupDraggable(content);

  // Make sections draggable
  setupDraggable(imagesSection);
  setupDraggable(promptsSection);

  queuePanel = panel;
  return queuePanel;
}

// Handler for moving the panel
function handleDragMove(e: MouseEvent) {
  if (!isDragging || !queuePanel) return;

  // Calculate how far the mouse has moved (direct calculation)
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;

  // Apply the transform directly - skipping requestAnimationFrame for maximum responsiveness
  queuePanel.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`; // Use translate3d for hardware acceleration

  // Prevent default behavior to avoid any delay
  e.preventDefault();
  e.stopPropagation();
}

// Handler for ending the drag
function handleDragEnd(e: MouseEvent) {
  if (!isDragging || !queuePanel) return;

  // Stop dragging
  isDragging = false;
  queuePanel?.classList.remove('dragging');

  // Remove event listeners
  document.removeEventListener('mousemove', handleDragMove, { capture: true });
  document.removeEventListener('mouseup', handleDragEnd, { capture: true });

  // Calculate new position
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;

  // Direct calculation of new position
  const newLeft = initialPanelX + deltaX;
  const newTop = initialPanelY + deltaY;

  // Get viewport boundaries (simplified)
  const rect = queuePanel.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 10;
  const maxTop = window.innerHeight - rect.height - 10;

  // Constrain position (simplified math)
  const finalLeft = newLeft < 10 ? 10 : newLeft > maxLeft ? maxLeft : newLeft;
  const finalTop = newTop < 10 ? 10 : newTop > maxTop ? maxTop : newTop;

  // Reset transform and set the new position in one operation
  queuePanel.style.cssText += `transform: none; left: ${finalLeft}px; top: ${finalTop}px;`;

  // Save position asynchronously to not block UI
  setTimeout(() => {
    chrome.storage.local.set({
      [PANEL_POSITION_STORAGE_KEY]: {
        top: finalTop,
        left: finalLeft,
      },
    });
  }, 0);
}

// Update footer buttons based on selection state
function updateFooterButtons() {
  if (!queuePanel) return;

  const shadow = queuePanel.getRootNode() as ShadowRoot;
  const actionBtn = shadow.querySelector('.action-btn') as HTMLButtonElement;

  if (!actionBtn) return;

  // Update the main paste button text based on selections
  if (selectedImageId && selectedPromptId) {
    actionBtn.disabled = false;
    actionBtn.innerHTML = '<span>Paste Image & Prompt</span>';
  } else if (selectedImageId) {
    actionBtn.disabled = false;
    actionBtn.innerHTML = '<span>Paste Image</span>';
  } else if (selectedPromptId) {
    actionBtn.disabled = false;
    actionBtn.innerHTML = '<span>Paste Prompt</span>';
  } else {
    actionBtn.disabled = true;
    actionBtn.innerHTML = '<span>Paste</span>';
  }

  // Update button visibility in footer
  console.log(`Current selections - Image: ${selectedImageId}, Prompt: ${selectedPromptId}`);
}

// Toggle the panel visibility
function toggleQueuePanel() {
  if (!queuePanel) return;

  queuePanelVisible = !queuePanelVisible;
  queuePanel.style.display = queuePanelVisible ? 'flex' : 'none';

  // Refresh content when showing
  if (queuePanelVisible) {
    const shadow = queuePanel.getRootNode() as ShadowRoot;

    // Log the current selection state on panel open
    console.log('Panel opened, current selections - Image:', selectedImageId, 'Prompt:', selectedPromptId);

    // Find the content sections
    const imagesContent = shadow.querySelector('.images-content');
    const promptsContent = shadow.querySelector('.prompts-content');

    // Update both sections
    if (imagesContent) {
      updateImageContent(imagesContent as HTMLElement);
    }

    if (promptsContent) {
      updatePromptContent(promptsContent as HTMLElement);
    }

    // Make sure to update the footer buttons
    updateFooterButtons();
  }
}

// Paste the selected image and/or prompt
async function pasteSelectedItem() {
  let success = false;
  const hostname = window.location.hostname;
  const isOnChatGPT = hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com');

  // Prepare for focus
  window.focus();
  document.documentElement.focus();

  // Create a focus helper to ensure document has focus
  const focusHelper = document.createElement('button');
  focusHelper.style.position = 'fixed';
  focusHelper.style.opacity = '0';
  focusHelper.style.pointerEvents = 'none';
  focusHelper.style.left = '-9999px';
  focusHelper.setAttribute('tabindex', '1');
  document.body.appendChild(focusHelper);
  focusHelper.focus();

  try {
    // Get selected image
    if (selectedImageId) {
      const storage = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
      const imageQueue: QueuedImage[] = storage[QUEUE_STORAGE_KEY] || [];
      const selectedImage = imageQueue.find(img => img.id === selectedImageId);

      if (selectedImage) {
        success = await copyImageToClipboard(selectedImage.dataUrl);
        if (success) {
          showToast('Image copied!', 'success');

          // If on ChatGPT, paste the image first
          if (isOnChatGPT) {
            await pasteIntoChatGPT();
            // Small delay to ensure image paste completes
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Handle prompt
          if (selectedPromptId) {
            const promptStorage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
            const promptQueue: QueuedPrompt[] = promptStorage[PROMPT_STORAGE_KEY] || [];
            const selectedPrompt = promptQueue.find(p => p.id === selectedPromptId);

            if (selectedPrompt) {
              // Copy the prompt to clipboard
              await navigator.clipboard.writeText(selectedPrompt.text);

              if (isOnChatGPT) {
                // Give ChatGPT a moment to process the image
                setTimeout(() => {
                  pasteIntoChatGPT();
                  showToast('Image & Prompt pasted!', 'success');
                }, 300);
              } else {
                showToast('Image & Prompt copied!', 'success');
              }
            }
          }
        }
      }
    } else if (selectedPromptId) {
      // Paste just the prompt
      const promptStorage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
      const promptQueue: QueuedPrompt[] = promptStorage[PROMPT_STORAGE_KEY] || [];
      const selectedPrompt = promptQueue.find(p => p.id === selectedPromptId);

      if (selectedPrompt) {
        try {
          await navigator.clipboard.writeText(selectedPrompt.text);

          if (isOnChatGPT) {
            await pasteIntoChatGPT();
            showToast('Prompt pasted!', 'success');
          } else {
            showToast('Prompt copied!', 'success');
          }

          success = true;
        } catch (err) {
          console.error('Failed to copy prompt:', err);
          showToast('Failed to copy prompt', 'error');
        }
      }
    }
  } catch (error) {
    console.error('Error in paste operation:', error);
    showToast('Error during paste operation', 'error');
  } finally {
    // Clean up focus helper
    if (document.body.contains(focusHelper)) {
      document.body.removeChild(focusHelper);
    }
  }

  return success;
}

// Add image to queue
async function addImageToQueue(imageDataUrl: string, sourceUrl: string): Promise<void> {
  try {
    // Generate thumbnail for UI display
    const thumbnailUrl = await generateThumbnail(imageDataUrl);

    // Get current queue
    const storage = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    let imageQueue: QueuedImage[] = storage[QUEUE_STORAGE_KEY] || [];

    // Create new queue item
    const newImage: QueuedImage = {
      id: generateUniqueId(),
      dataUrl: imageDataUrl,
      sourceUrl: sourceUrl,
      timestamp: Date.now(),
      thumbnailUrl: thumbnailUrl,
    };

    // Add to beginning of queue
    imageQueue.unshift(newImage);

    // Limit queue size
    if (imageQueue.length > MAX_QUEUE_SIZE) {
      imageQueue = imageQueue.slice(0, MAX_QUEUE_SIZE);
    }

    // Save updated queue
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: imageQueue });

    // Update UI if panel exists and is visible
    if (queuePanel && queuePanelVisible) {
      const content = queuePanel.querySelector('.panel-content');
      if (content) {
        updateImageContent(content.querySelector('.images-content') as HTMLElement);
      }
    }

    console.log('Image added to queue, current size:', imageQueue.length);
  } catch (error) {
    console.error('Failed to add image to queue:', error);
  }
}

// Generate a smaller thumbnail for UI display
async function generateThumbnail(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Calculate dimensions while preserving aspect ratio
      const MAX_SIZE = 150;
      let width = img.width;
      let height = img.height;

      // Determine which dimension to constrain
      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round(height * (MAX_SIZE / width));
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round(width * (MAX_SIZE / height));
          height = MAX_SIZE;
        }
      }

      // Create canvas for the thumbnail
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      // Draw resized image
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Unable to get canvas context');
        resolve('');
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Get thumbnail data URL (use JPEG for smaller size)
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };

    img.onerror = () => {
      console.error('Failed to load image for thumbnail');
      resolve(dataUrl); // Fall back to original on error
    };

    img.src = dataUrl;
  });
}

// Generate a unique ID for each image
function generateUniqueId(): string {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Refined keyboard shortcut handler
function setupKeyboardShortcut() {
  document.addEventListener('keydown', async event => {
    if (event.altKey && (event.key === 'z' || event.key === 'Z')) {
      // Check for Z too
      console.log('Keyboard shortcut Alt+Z detected!');
      event.preventDefault();
      event.stopPropagation(); // Prevent event bubbling

      const highlightedElement = window.__highlightedElement;
      if (!highlightedElement) {
        showToast('No image selected. Hover over an image.', 'error');
        return;
      }

      const imageUrl = getImageFromElement(highlightedElement);
      if (!imageUrl) {
        showToast('Failed to extract image source.', 'error');
        return;
      }

      // --- Enhanced Focus Management ---
      // Store active element to restore focus later
      const activeElement = document.activeElement;

      // Create a more robust focus helper
      const focusHelper = document.createElement('button'); // Using button for better focus behavior
      focusHelper.style.position = 'fixed';
      focusHelper.style.opacity = '0';
      focusHelper.style.pointerEvents = 'none';
      focusHelper.style.left = '-9999px';
      focusHelper.setAttribute('tabindex', '1'); // Ensure focusable
      document.body.appendChild(focusHelper);

      // Multiple focus attempts with different methods
      window.focus();
      document.documentElement.focus();
      focusHelper.focus(); // Attempt to ensure document focus

      // Small delay to ensure focus is established
      await new Promise(resolve => setTimeout(resolve, 50));
      // --- End Enhanced Focus Management ---

      showToast('Processing image...', 'info', 1000); // Shorter duration

      try {
        const dataUrl = await urlToDataURL(imageUrl);
        console.log('Document has focus before copy attempt:', document.hasFocus());
        const copySuccess = await copyImageToClipboard(dataUrl);

        if (copySuccess) {
          showToast('Image copied!', 'success');
          await addImageToQueue(dataUrl, imageUrl); // Add to queue on success

          // Check if on ChatGPT and attempt paste
          const hostname = window.location.hostname;
          if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
            console.log('Detected ChatGPT site, attempting paste...');
            // Use a minimal delay, relying on user focus potentially being maintained
            setTimeout(() => pasteIntoChatGPT(), 100);
          }
        }
        // No "else" here, copyImageToClipboard shows its own error toast
      } catch (error) {
        console.error('Error processing image shortcut:', error);
        showToast('Error processing image', 'error');
      } finally {
        // --- Restore Focus ---
        if (document.body.contains(focusHelper)) {
          document.body.removeChild(focusHelper);
        }
        // Try to restore original focus
        if (activeElement instanceof HTMLElement) {
          try {
            // Small delay before restoring focus, might help in some cases
            setTimeout(() => activeElement.focus({ preventScroll: true }), 50);
          } catch (focusError) {
            console.warn('Could not restore focus:', focusError);
          }
        }
        // --- End Restore Focus ---
      }
    }
  });
}

// Helper function to convert image URL to Data URL (might need background script for CORS)
async function urlToDataURL(url: string): Promise<string> {
  try {
    // Try direct fetch first (works for same-origin or CORS-enabled images)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Direct fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.log('Direct fetch failed, trying background fetch for:', url, e);
    // Fallback to background script for potential CORS bypass
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'fetchImage', imageUrl: url }, response => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message || 'Background fetch failed'));
        }
        if (response?.success) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || 'Failed to fetch image via background'));
        }
      });
    });
  }
}

// Refined function to copy image data (Data URL) to clipboard
async function copyImageToClipboard(imageDataUrl: string): Promise<boolean> {
  if (!navigator.clipboard || !window.ClipboardItem) {
    console.error('Clipboard API or ClipboardItem not supported.');
    showToast('Clipboard API not available', 'error');
    return false;
  }

  try {
    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();

    // Additional focus attempt right before clipboard operation
    window.focus();
    document.documentElement.focus();

    // Use the Clipboard API
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);
    console.log('Image successfully copied to clipboard via content script.');
    return true;
  } catch (error) {
    console.error('Content Script: Failed to write to clipboard:', error);

    // Attempt fallback method if it's a focus-related error
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      try {
        // Create a temporary image element
        const img = new Image();
        img.src = imageDataUrl;
        await new Promise<void>(resolve => {
          img.onload = () => resolve();
          img.onerror = () => {
            console.error('Failed to load image for fallback method');
            resolve();
          };
        });

        // Create a canvas and draw the image on it
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 200;
        canvas.height = img.height || 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('Unable to get canvas context');
          return false;
        }

        ctx.drawImage(img, 0, 0);

        // Try canvas-based copy as fallback
        const success = await new Promise<boolean>(resolve => {
          canvas.toBlob(async blob => {
            if (!blob) {
              resolve(false);
              return;
            }

            try {
              // One more focus attempt
              window.focus();
              document.documentElement.focus();

              await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
              resolve(true);
            } catch (e) {
              console.error('Fallback clipboard method failed:', e);
              resolve(false);
            }
          });
        });

        if (success) {
          console.log('Image copied using fallback method');
          return true;
        }
      } catch (fallbackError) {
        console.error('Error in fallback clipboard method:', fallbackError);
      }

      showToast('Copy failed: Page needs focus. Click on page first.', 'error', 3000);
    } else {
      showToast('Failed to copy image.', 'error');
    }
    return false;
  }
}

// Update image content
async function updateImageContent(contentElement: HTMLElement) {
  // Clear current content
  contentElement.innerHTML = '';

  // Get queue from storage
  const storage = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
  const imageQueue: QueuedImage[] = storage[QUEUE_STORAGE_KEY] || [];

  if (imageQueue.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = 'No images captured yet. Use Alt+Z on an image.';
    contentElement.appendChild(emptyMsg);
    return;
  }

  // Create thumbnail container
  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container';

  // Sort by timestamp, newest first
  imageQueue.sort((a, b) => b.timestamp - a.timestamp);

  // Add each thumbnail
  for (const image of imageQueue) {
    const thumbnail = document.createElement('div');
    thumbnail.className = 'thumbnail';
    thumbnail.dataset.id = image.id;

    // Check if this image is selected
    if (selectedImageId === image.id) {
      thumbnail.classList.add('selected');
    }

    const img = document.createElement('img');
    img.src = image.thumbnailUrl || image.dataUrl;
    img.title = `Captured: ${new Date(image.timestamp).toLocaleString()}`;
    thumbnail.appendChild(img);

    // Add delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '✕';
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', async e => {
      e.stopPropagation(); // Prevent selection of the image
      await deleteImage(image.id);
      updateImageContent(contentElement); // Refresh the list

      if (selectedImageId === image.id) {
        selectedImageId = null; // Clear selection if deleted
        document.dispatchEvent(new CustomEvent('selection-changed'));
      }
    });
    thumbnail.appendChild(deleteBtn);

    // Click to select this image
    thumbnail.addEventListener('click', async () => {
      // Toggle selection if already selected
      if (selectedImageId === image.id) {
        selectedImageId = null;
      } else {
        selectedImageId = image.id;
      }
      selectedPromptId = null;
      document.dispatchEvent(new CustomEvent('selection-changed'));

      // Update UI to show selection
      const allImages = thumbnailContainer.querySelectorAll('.thumbnail');
      allImages.forEach(item => item.classList.remove('selected'));
      if (selectedImageId) {
        thumbnail.classList.add('selected');
      }
    });

    thumbnailContainer.appendChild(thumbnail);
  }

  contentElement.appendChild(thumbnailContainer);
}

// Update prompt content
async function updatePromptContent(contentElement: HTMLElement) {
  // Clear current content
  contentElement.innerHTML = '';

  // Create prompt input area first
  const promptInputContainer = document.createElement('div');
  promptInputContainer.className = 'prompt-input-container';
  promptInputContainer.style.marginBottom = '16px';
  promptInputContainer.style.display = 'flex';
  promptInputContainer.style.flexDirection = 'column';
  promptInputContainer.style.gap = '8px';

  const promptInputLabel = document.createElement('div');
  promptInputLabel.textContent = 'Create New Prompt';
  promptInputLabel.style.fontSize = '14px';
  promptInputLabel.style.fontWeight = '500';
  promptInputContainer.appendChild(promptInputLabel);

  const inputWrapper = document.createElement('div');
  inputWrapper.style.display = 'flex';
  inputWrapper.style.gap = '8px';

  const promptInput = document.createElement('textarea');
  promptInput.placeholder = 'Type your prompt here...';
  promptInput.style.flex = '1';
  promptInput.style.padding = '8px 12px';
  promptInput.style.borderRadius = '6px';
  promptInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
  promptInput.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
  promptInput.style.color = 'white';
  promptInput.style.resize = 'vertical';
  promptInput.style.minHeight = '60px';
  promptInput.style.fontSize = '14px';
  inputWrapper.appendChild(promptInput);

  // Create a save button for the prompt input
  const savePromptBtn = document.createElement('button');
  savePromptBtn.textContent = 'Save';
  savePromptBtn.className = 'save-btn';
  savePromptBtn.style.backgroundColor = '#1a1a1a';
  savePromptBtn.style.color = 'white';
  savePromptBtn.style.border = 'none';
  savePromptBtn.style.borderRadius = '6px';
  savePromptBtn.style.padding = '8px 16px';
  savePromptBtn.style.fontSize = '14px';
  savePromptBtn.style.fontWeight = '500';
  savePromptBtn.style.cursor = 'pointer';
  savePromptBtn.style.alignSelf = 'flex-start';
  savePromptBtn.style.height = 'fit-content';

  savePromptBtn.addEventListener('click', async () => {
    const promptText = promptInput.value.trim();
    if (promptText) {
      await addPromptToQueue(promptText);
      promptInput.value = ''; // Clear input

      // Instead of recursively calling updatePromptContent, directly update the prompt list
      const storage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
      const promptQueue: QueuedPrompt[] = storage[PROMPT_STORAGE_KEY] || [];

      // Clear existing prompts and re-render
      const existingListContainer = contentElement.querySelector('.prompt-list-container');
      if (existingListContainer) {
        contentElement.removeChild(existingListContainer);
      }

      // Create and append a new prompt list container
      const promptListContainer = document.createElement('div');
      promptListContainer.className = 'prompt-list-container';

      const promptListHeader = document.createElement('div');
      promptListHeader.textContent = 'Saved Prompts';
      promptListHeader.style.fontSize = '14px';
      promptListHeader.style.fontWeight = '500';
      promptListHeader.style.marginBottom = '8px';
      promptListHeader.style.paddingBottom = '8px';
      promptListHeader.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
      promptListContainer.appendChild(promptListHeader);

      // Prompt container
      const promptContainer = document.createElement('div');
      promptContainer.className = 'prompt-container';

      // Sort by timestamp, newest first
      promptQueue.sort((a, b) => b.timestamp - a.timestamp);

      for (const prompt of promptQueue) {
        const promptItem = document.createElement('div');
        promptItem.className = 'prompt-item';
        promptItem.dataset.id = prompt.id;

        // Check if this prompt is selected
        if (selectedPromptId === prompt.id) {
          promptItem.classList.add('selected');
        }

        const text = document.createElement('p');
        text.className = 'prompt-text';
        text.textContent = prompt.text;
        promptItem.appendChild(text);

        const meta = document.createElement('div');
        meta.className = 'prompt-meta';
        meta.textContent = `Saved: ${new Date(prompt.timestamp).toLocaleString()}`;
        promptItem.appendChild(meta);

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '✕';
        deleteBtn.title = 'Delete prompt';
        deleteBtn.addEventListener('click', async e => {
          e.stopPropagation(); // Prevent selection of the prompt
          await deletePrompt(prompt.id);
          updatePromptContent(contentElement); // Refresh the list

          if (selectedPromptId === prompt.id) {
            selectedPromptId = null; // Clear selection if deleted
            document.dispatchEvent(new CustomEvent('selection-changed'));
          }
        });
        promptItem.appendChild(deleteBtn);

        // Click to select this prompt
        promptItem.addEventListener('click', () => {
          // Toggle selection
          if (selectedPromptId === prompt.id) {
            selectedPromptId = null;
          } else {
            selectedPromptId = prompt.id;
          }

          // Log the selection for debugging
          console.log('Prompt selection changed to:', selectedPromptId);

          document.dispatchEvent(new CustomEvent('selection-changed'));

          // Update UI to show selection
          const allPrompts = promptContainer.querySelectorAll('.prompt-item');
          allPrompts.forEach(item => item.classList.remove('selected'));
          if (selectedPromptId) {
            promptItem.classList.add('selected');
          }
        });

        promptContainer.appendChild(promptItem);
      }

      promptListContainer.appendChild(promptContainer);
      contentElement.appendChild(promptListContainer);

      showToast('Prompt saved!', 'success');
    } else {
      showToast('Please enter a prompt', 'error');
    }
  });

  // Add keyboard shortcut to save with Ctrl+Enter or Cmd+Enter
  promptInput.addEventListener('keydown', async e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const promptText = promptInput.value.trim();
      if (promptText) {
        await addPromptToQueue(promptText);
        promptInput.value = ''; // Clear input

        // Trigger click on save button to reuse the same logic
        savePromptBtn.click();
      } else {
        showToast('Please enter a prompt', 'error');
      }
    }
  });

  inputWrapper.appendChild(savePromptBtn);
  promptInputContainer.appendChild(inputWrapper);
  contentElement.appendChild(promptInputContainer);

  // Create prompts list
  const promptListContainer = document.createElement('div');
  promptListContainer.className = 'prompt-list-container';

  const promptListHeader = document.createElement('div');
  promptListHeader.textContent = 'Saved Prompts';
  promptListHeader.style.fontSize = '14px';
  promptListHeader.style.fontWeight = '500';
  promptListHeader.style.marginBottom = '8px';
  promptListHeader.style.paddingBottom = '8px';
  promptListHeader.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
  promptListContainer.appendChild(promptListHeader);

  // Get prompts from storage
  const storage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
  const promptQueue: QueuedPrompt[] = storage[PROMPT_STORAGE_KEY] || [];

  if (promptQueue.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = 'No prompts saved yet. Type a prompt above and click Save.';
    promptListContainer.appendChild(emptyMsg);
    contentElement.appendChild(promptListContainer);
    return;
  }

  // Prompt container
  const promptContainer = document.createElement('div');
  promptContainer.className = 'prompt-container';

  // Sort by timestamp, newest first
  promptQueue.sort((a, b) => b.timestamp - a.timestamp);

  for (const prompt of promptQueue) {
    const promptItem = document.createElement('div');
    promptItem.className = 'prompt-item';
    promptItem.dataset.id = prompt.id;

    // Check if this prompt is selected
    if (selectedPromptId === prompt.id) {
      promptItem.classList.add('selected');
    }

    const text = document.createElement('p');
    text.className = 'prompt-text';
    text.textContent = prompt.text;
    promptItem.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'prompt-meta';
    meta.textContent = `Saved: ${new Date(prompt.timestamp).toLocaleString()}`;
    promptItem.appendChild(meta);

    // Add delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '✕';
    deleteBtn.title = 'Delete prompt';
    deleteBtn.addEventListener('click', async e => {
      e.stopPropagation(); // Prevent selection of the prompt
      await deletePrompt(prompt.id);
      updatePromptContent(contentElement); // Refresh the list

      if (selectedPromptId === prompt.id) {
        selectedPromptId = null; // Clear selection if deleted
        document.dispatchEvent(new CustomEvent('selection-changed'));
      }
    });
    promptItem.appendChild(deleteBtn);

    // Click to select this prompt
    promptItem.addEventListener('click', () => {
      // Toggle selection
      if (selectedPromptId === prompt.id) {
        selectedPromptId = null;
      } else {
        selectedPromptId = prompt.id;
      }

      // Log the selection for debugging
      console.log('Prompt selection changed to:', selectedPromptId);

      document.dispatchEvent(new CustomEvent('selection-changed'));

      // Update UI to show selection
      const allPrompts = promptContainer.querySelectorAll('.prompt-item');
      allPrompts.forEach(item => item.classList.remove('selected'));
      if (selectedPromptId) {
        promptItem.classList.add('selected');
      }
    });

    promptContainer.appendChild(promptItem);
  }

  promptListContainer.appendChild(promptContainer);
  contentElement.appendChild(promptListContainer);
}

// Delete an image from storage
async function deleteImage(imageId: string): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    let imageQueue: QueuedImage[] = storage[QUEUE_STORAGE_KEY] || [];

    // Remove the image with the given ID
    imageQueue = imageQueue.filter(img => img.id !== imageId);

    // Save updated queue
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: imageQueue });

    console.log(`Image ${imageId} deleted from queue`);
  } catch (error) {
    console.error('Failed to delete image:', error);
  }
}

// Delete a prompt from storage
async function deletePrompt(promptId: string): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
    let promptQueue: QueuedPrompt[] = storage[PROMPT_STORAGE_KEY] || [];

    // Remove the prompt with the given ID
    promptQueue = promptQueue.filter(p => p.id !== promptId);

    // Save updated queue
    await chrome.storage.local.set({ [PROMPT_STORAGE_KEY]: promptQueue });

    console.log(`Prompt ${promptId} deleted from queue`);
  } catch (error) {
    console.error('Failed to delete prompt:', error);
  }
}

// Function to add a prompt to the queue
async function addPromptToQueue(text: string, source?: string): Promise<void> {
  try {
    // Get current queue
    const storage = await chrome.storage.local.get(PROMPT_STORAGE_KEY);
    let promptQueue: QueuedPrompt[] = storage[PROMPT_STORAGE_KEY] || [];

    // Check if this prompt already exists
    const trimmedText = text.trim();
    const existingPromptIndex = promptQueue.findIndex(p => p.text.trim() === trimmedText);

    if (existingPromptIndex >= 0) {
      // Move existing prompt to the top of the queue
      const existingPrompt = promptQueue.splice(existingPromptIndex, 1)[0];
      existingPrompt.timestamp = Date.now(); // Update timestamp
      promptQueue.unshift(existingPrompt);
      console.log('Existing prompt moved to top of queue');
      showToast('Prompt already exists, moved to top', 'info');
    } else {
      // Create new prompt object
      const newPrompt: QueuedPrompt = {
        id: generateUniqueId(),
        text: trimmedText,
        timestamp: Date.now(),
        source: source,
      };

      // Add to beginning of queue
      promptQueue.unshift(newPrompt);
      console.log('New prompt added to queue');
    }

    // Limit queue size
    if (promptQueue.length > MAX_QUEUE_SIZE) {
      promptQueue = promptQueue.slice(0, MAX_QUEUE_SIZE);
    }

    // Save updated queue
    await chrome.storage.local.set({ [PROMPT_STORAGE_KEY]: promptQueue });

    // Update UI if panel exists and is visible
    if (queuePanel && queuePanelVisible) {
      const content = queuePanel.querySelector('.panel-content');
      if (content) {
        const promptsContent = content.querySelector('.prompts-content');
        if (promptsContent) {
          updatePromptContent(promptsContent as HTMLElement);
        }
      }
    }

    console.log('Prompt queue updated, current size:', promptQueue.length);
  } catch (error) {
    console.error('Failed to add prompt to queue:', error);
    showToast('Failed to save prompt', 'error');
  }
}

// Function to refresh the panel content
function refreshPanelContent() {
  if (!queuePanel) return;

  const shadow = queuePanel.getRootNode() as ShadowRoot;

  // Find the content sections
  const imagesContent = shadow.querySelector('.images-content');
  const promptsContent = shadow.querySelector('.prompts-content');

  // Show a toast notification
  showToast('Refreshing panel content...', 'info');

  // Update both sections
  if (imagesContent) {
    updateImageContent(imagesContent as HTMLElement);
  }

  if (promptsContent) {
    updatePromptContent(promptsContent as HTMLElement);
  }

  // Update footer buttons
  updateFooterButtons();

  // Show completion toast
  setTimeout(() => {
    showToast('Panel content refreshed!', 'success');
  }, 300);
}

// Initialize function
function initialize() {
  setupImageHighlighting();
  setupMutationObserver();
  setupKeyboardShortcut();
  registerContentScriptReady();

  // Check if domain is allowed before showing UI
  const hostname = window.location.hostname;
  if (!hostname.includes('chrome.google.com') && !hostname.includes('chrome-extension:')) {
    // Create UI for image queue
    createQueuePanel();
  }

  // Check if we're on ChatGPT and set up helper
  checkIfChatGPTAndSetupHelper();

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
