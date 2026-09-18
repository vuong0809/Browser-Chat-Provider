// src/content/observer.js

/**
 * PageObserver
 *
 * Watches SPA navigation and relevant page metadata changes.
 *
 * It does NOT contain ChatGPT-specific selectors.
 * Provider-specific state is read through the adapter.
 */

export class PageObserver {

  constructor({
    adapter,
    onChange = null,
    debounceMs = 250,
    pollIntervalMs = 1000
  }) {

    if (!adapter) {
      throw new Error(
        "PageObserver requires adapter"
      );
    }


    this.adapter =
      adapter;


    this.onChange =
      onChange;


    this.debounceMs =
      debounceMs;


    this.pollIntervalMs =
      pollIntervalMs;


    this.running =
      false;


    this.mutationObserver =
      null;


    this.pollTimer =
      null;


    this.debounceTimer =
      null;


    this.lastState =
      null;


    this.originalPushState =
      null;


    this.originalReplaceState =
      null;


    this.boundPopState =
      this._handleNavigation.bind(this);


    this.boundHashChange =
      this._handleNavigation.bind(this);
  }


  // ==========================================================
  // Start
  // ==========================================================

  start() {

    if (this.running) {
      return;
    }


    this.running =
      true;


    this.lastState =
      this._captureState();


    console.log(
      "[PageObserver] Started:",
      this.lastState
    );


    // --------------------------------------------------------
    // History API
    // --------------------------------------------------------

    this._patchHistory();


    // --------------------------------------------------------
    // Browser navigation
    // --------------------------------------------------------

    window.addEventListener(
      "popstate",
      this.boundPopState
    );


    window.addEventListener(
      "hashchange",
      this.boundHashChange
    );


    // --------------------------------------------------------
    // DOM changes
    // --------------------------------------------------------

    if (document.documentElement) {

      this.mutationObserver =
        new MutationObserver(
          () => {
            this._scheduleCheck();
          }
        );


      this.mutationObserver.observe(
        document.documentElement,
        {
          childList: true,
          subtree: true
        }
      );
    }


    // --------------------------------------------------------
    // Poll fallback
    // --------------------------------------------------------

    this.pollTimer =
      setInterval(
        () => {
          this._check();
        },
        this.pollIntervalMs
      );
  }


  // ==========================================================
  // Stop
  // ==========================================================

  stop() {

    if (!this.running) {
      return;
    }


    this.running =
      false;


    if (this.mutationObserver) {

      this.mutationObserver.disconnect();

      this.mutationObserver =
        null;
    }


    if (this.pollTimer) {

      clearInterval(
        this.pollTimer
      );

      this.pollTimer =
        null;
    }


    if (this.debounceTimer) {

      clearTimeout(
        this.debounceTimer
      );

      this.debounceTimer =
        null;
    }


    window.removeEventListener(
      "popstate",
      this.boundPopState
    );


    window.removeEventListener(
      "hashchange",
      this.boundHashChange
    );


    this._restoreHistory();


    console.log(
      "[PageObserver] Stopped"
    );
  }


  // ==========================================================
  // Current state
  // ==========================================================

  getState() {

    return this._captureState();
  }


  // ==========================================================
  // Navigation
  // ==========================================================

  _handleNavigation() {

    if (!this.running) {
      return;
    }


    this._scheduleCheck();
  }


  // ==========================================================
  // History patch
  // ==========================================================

  _patchHistory() {

    if (
      this.originalPushState ||
      this.originalReplaceState
    ) {
      return;
    }


    this.originalPushState =
      history.pushState;


    this.originalReplaceState =
      history.replaceState;


    const observer =
      this;


    history.pushState =
      function (...args) {

        const result =
          observer.originalPushState
            .apply(
              this,
              args
            );


        observer._handleNavigation();


        return result;
      };


    history.replaceState =
      function (...args) {

        const result =
          observer.originalReplaceState
            .apply(
              this,
              args
            );


        observer._handleNavigation();


        return result;
      };
  }


  // ==========================================================
  // Restore History API
  // ==========================================================

  _restoreHistory() {

    if (this.originalPushState) {

      history.pushState =
        this.originalPushState;


      this.originalPushState =
        null;
    }


    if (this.originalReplaceState) {

      history.replaceState =
        this.originalReplaceState;


      this.originalReplaceState =
        null;
    }
  }


  // ==========================================================
  // Debounced check
  // ==========================================================

  _scheduleCheck() {

    if (!this.running) {
      return;
    }


    if (this.debounceTimer) {

      clearTimeout(
        this.debounceTimer
      );
    }


    this.debounceTimer =
      setTimeout(
        () => {

          this.debounceTimer =
            null;


          this._check();

        },
        this.debounceMs
      );
  }


  // ==========================================================
  // Check
  // ==========================================================

  _check() {

    if (!this.running) {
      return;
    }


    let currentState;


    try {

      currentState =
        this._captureState();

    } catch (error) {

      console.debug(
        "[PageObserver] State capture failed:",
        error
      );

      return;
    }


    if (
      this._statesEqual(
        this.lastState,
        currentState
      )
    ) {
      return;
    }


    const previousState =
      this.lastState;


    this.lastState =
      currentState;


    console.log(
      "[PageObserver] State changed:",
      {
        previous:
          previousState,

        current:
          currentState
      }
    );


    this._emitChange(
      currentState,
      previousState
    );
  }


  // ==========================================================
  // Capture state
  // ==========================================================

  _captureState() {

    let detected =
      false;


    let ready =
      false;


    let conversationId =
      null;


    let title =
      document.title || null;


    try {

      detected =
        Boolean(
          this.adapter.detect()
        );

    } catch {
      detected = false;
    }


    try {

      ready =
        Boolean(
          this.adapter.isReady()
        );

    } catch {
      ready = false;
    }


    try {

      conversationId =
        this.adapter
          .getConversationId();

    } catch {
      conversationId = null;
    }


    try {

      title =
        this.adapter.getTitle();

    } catch {
      // Keep document.title fallback.
    }


    return {

      url:
        window.location.href,

      pathname:
        window.location.pathname,

      detected,

      ready,

      busy:
        this.adapter.isBusy(),

      conversationId,

      title
    };
  }


  // ==========================================================
  // State comparison
  // ==========================================================

  _statesEqual(
    a,
    b
  ) {

    if (!a || !b) {
      return false;
    }


    return (
      a.url === b.url &&
      a.pathname === b.pathname &&
      a.detected === b.detected &&
      a.ready === b.ready &&
      a.busy === b.busy &&
      a.conversationId ===
        b.conversationId &&
      a.title === b.title
    );
  }


  // ==========================================================
  // Emit
  // ==========================================================

  _emitChange(
    current,
    previous
  ) {

    if (
      typeof this.onChange !==
      "function"
    ) {
      return;
    }


    try {

      this.onChange({
        current,
        previous
      });

    } catch (error) {

      console.error(
        "[PageObserver] onChange failed:",
        error
      );
    }
  }
}