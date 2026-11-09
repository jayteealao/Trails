// @ts-check
import { el } from './el.js';
import { state } from './state.js';

export function setLoading(loading) {
  state.loading = loading;
  el.loadingOverlay.classList.toggle('hidden', !loading);
}

export function showError(message) {
  state.error = message;
  el.errorMessage.textContent = message;
  el.errorBanner.className = 'toast toast-error';
}

export function clearError() {
  state.error = null;
  el.errorBanner.className = 'toast hidden';
}

export function showToast(message) {
  el.toastMessage.textContent = message;
  el.toastBanner.className = 'toast toast-success';

  setTimeout(() => {
    el.toastBanner.className = 'toast hidden';
  }, 2500);
}
