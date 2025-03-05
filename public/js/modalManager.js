// modalManager.js

let modalOverlay = null;

function createModal() {
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.className = 'custom-modal-overlay';
    modalOverlay.innerHTML = `
      <div class="custom-modal">
        <h3 class="custom-modal-title"></h3>
        <p class="custom-modal-message"></p>
        <div class="custom-modal-timer"></div>
        <div class="custom-modal-buttons"></div>
      </div>
    `;
    document.body.appendChild(modalOverlay);
  }
}

function showModal({ title, message, countdown, buttons }) {
  createModal();

  // Clear any previously stored interval and timeout to avoid conflicts.
  if (modalOverlay._interval) {
    clearInterval(modalOverlay._interval);
    modalOverlay._interval = null;
  }
  if (modalOverlay._timeout) {
    clearTimeout(modalOverlay._timeout);
    modalOverlay._timeout = null;
  }

  const titleElem = modalOverlay.querySelector('.custom-modal-title');
  const messageElem = modalOverlay.querySelector('.custom-modal-message');
  const timerElem = modalOverlay.querySelector('.custom-modal-timer');
  const buttonsElem = modalOverlay.querySelector('.custom-modal-buttons');

  titleElem.textContent = title;
  messageElem.textContent = message;
  timerElem.textContent =
    typeof countdown === 'number' ? `Auto-allow in ${countdown}s` : '';
  buttonsElem.innerHTML = '';

  if (buttons && Array.isArray(buttons)) {
    buttons.forEach((btn) => {
      const button = document.createElement('button');
      button.textContent = btn.text;
      button.style.margin = '0 5px';
      button.onclick = () => {
        if (btn.onClick) btn.onClick();
        hideModal();
      };
      buttonsElem.appendChild(button);
    });
  }

  modalOverlay.style.display = 'flex';

  // Use both an interval (to update display) and a setTimeout to ensure the full countdown time.
  if (typeof countdown === 'number') {
    let timeLeft = countdown;
    timerElem.textContent = `Auto-allow in ${timeLeft}s`;

    const interval = setInterval(() => {
      timeLeft--;
      timerElem.textContent = `Auto-allow in ${timeLeft}s`;
    }, 1000);
    modalOverlay._interval = interval;

    const timeout = setTimeout(() => {
      clearInterval(interval);
      modalOverlay._interval = null;
      hideModal();
      // Execute auto-timeout callback if provided as the first button’s configuration.
      if (buttons && buttons.length && buttons[0].autoTimeoutCallback) {
        buttons[0].autoTimeoutCallback();
      }
    }, countdown * 1000);
    modalOverlay._timeout = timeout;
  }
}

export function hideModal() {
  if (modalOverlay) {
    modalOverlay.style.display = 'none';
    if (modalOverlay._interval) {
      clearInterval(modalOverlay._interval);
      modalOverlay._interval = null;
    }
    if (modalOverlay._timeout) {
      clearTimeout(modalOverlay._timeout);
      modalOverlay._timeout = null;
    }
  }
}

export function showHostRequestModal(app, data, countdownTime = 30) {
  // This modal is shown on the active host side to allow an incoming host-transfer request.
  showModal({
    title: 'Host Control Request',
    message: 'A viewer has requested to take over.',
    countdown: countdownTime,
    buttons: [
      {
        text: 'Allow',
        onClick: () => {
          app.socket.emit('release-host', { requestId: data.requestId });
        },
        autoTimeoutCallback: () => {
          app.socket.emit('auto-promote', { requestId: data.requestId });
        },
      },
      {
        text: 'Deny',
        onClick: () => {
          app.socket.emit('deny-host', { requestId: data.requestId });
        },
      },
    ],
  });
}

export function showViewerRequestModal(app, countdownTime = 30) {
  // This modal is shown on the viewer side when requesting the host role.
  showModal({
    title: 'Host Control Request',
    message: 'Awaiting host to allow.',
    countdown: countdownTime,
    buttons: [
      {
        text: 'Cancel',
        onClick: () => {
          app.socket.emit('cancel-host-request');
          app.hostRequestPending = false;
        },
        autoTimeoutCallback: () => {
          app.socket.emit('auto-promote');
        },
      },
    ],
  });
}

export function showConfirmationModal(message) {
  // A generic confirmation modal with an OK button and no countdown.
  showModal({
    title: 'Confirmation',
    message: message,
    buttons: [
      {
        text: 'OK',
        onClick: () => {
          hideModal();
        },
      },
    ],
  });
}

// Inject modal CSS.
const style = document.createElement('style');
style.textContent = `
.custom-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.5);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.custom-modal {
  background: white;
  padding: 30px;
  border-radius: 8px;
  width: 300px;
  text-align: center;
}
.custom-modal-title {
  margin-bottom: 5px;
}

.custom-modal-message {
  padding: 20px 0px
}
.custom-modal-buttons button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background: #d00024;
  color: white;
  cursor: pointer;
  transition: background 0.3s ease;
}
.custom-modal-buttons button:hover {
  background: #b0001d;
}
.custom-modal-timer {
  margin: 10px;
  font-size: small;
  font-weight: 400;
}
`;
document.head.appendChild(style);
