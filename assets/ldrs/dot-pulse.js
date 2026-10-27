/*
 * DotPulse loader from ldrs 1.1.9 (https://github.com/GriffinJohnston/ldrs), the web-component build, as one plain
 * script so the pages can load it without a bundler. Defines <l-dot-pulse size="43" speed="1.3" color="...">.
 * color="currentColor" makes the dots take the CSS color of the element, so each page sets it in its own palette.
 *
 * MIT License
 *
 * Copyright (c) 2022 Griffin Johnston
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
(function () {
  if (!window.customElements || customElements.get("l-dot-pulse")) return;

  class LdrsBaseElement extends HTMLElement {
    _propsToUpgrade = {};
    shadow;
    template;
    defaultProps;
    isAttached = false;
    constructor() {
      super();
      this.shadow = this.attachShadow({ mode: "open" });
      this.template = document.createElement("template");
    }
    storePropsToUpgrade(props) {
      props.forEach((p) => {
        if (this.hasOwnProperty(p) && this[p] !== undefined) { this._propsToUpgrade[p] = this[p]; delete this[p]; }
      });
    }
    upgradeStoredProps() {
      Object.entries(this._propsToUpgrade).forEach(([p, v]) => { this.setAttribute(p, v); });
    }
    reflect(props) {
      props.forEach((p) => {
        Object.defineProperty(this, p, {
          set(v) { "string,number".includes(typeof v) ? this.setAttribute(p, v.toString()) : this.removeAttribute(p); },
          get() { return this.getAttribute(p); },
        });
      });
    }
    applyDefaultProps(defaults) {
      this.defaultProps = defaults;
      Object.entries(defaults).forEach(([p, v]) => { this[p] = this[p] || v.toString(); });
    }
  }

  const CSS = ':host{--uib-dot-size:calc(var(--uib-size)*0.24);align-items:center;display:inline-flex;flex-shrink:0;height:var(--uib-dot-size);justify-content:center;width:var(--uib-size)}:host([hidden]){display:none}.container{align-items:center;display:flex;height:100%;justify-content:space-between;position:relative;width:100%}.container:after,.container:before,.dot{background-color:var(--uib-color);border-radius:50%;content:"";display:block;height:var(--uib-dot-size);transform:scale(0);transition:background-color .3s ease;width:var(--uib-dot-size)}.container:before{animation:pulse var(--uib-speed) ease-in-out calc(var(--uib-speed)*-.375) infinite}.dot{animation:pulse var(--uib-speed) ease-in-out calc(var(--uib-speed)*-.25) infinite both}.container:after{animation:pulse var(--uib-speed) ease-in-out calc(var(--uib-speed)*-.125) infinite}@keyframes pulse{0%,to{transform:scale(0)}50%{transform:scale(1)}}';

  class DotPulse extends LdrsBaseElement {
    _attributes = ["size", "color", "speed"];
    size;
    color;
    speed;
    static get observedAttributes() { return ["size", "color", "speed"]; }
    constructor() {
      super();
      this.storePropsToUpgrade(this._attributes);
      this.reflect(this._attributes);
    }
    vars() {
      return `:host{--uib-size: ${this.size}px; --uib-color: ${this.color}; --uib-speed: ${this.speed}s;} ${CSS}`;
    }
    connectedCallback() {
      this.upgradeStoredProps();
      this.applyDefaultProps({ size: 43, color: "black", speed: 1.3 });
      this.template.innerHTML = `<div class="container"><div class="dot" /></div><style>${this.vars()}</style>`;
      this.shadow.replaceChildren(this.template.content.cloneNode(true));
    }
    attributeChangedCallback() {
      const style = this.shadow.querySelector("style");
      if (style) style.innerHTML = this.vars();
    }
  }

  customElements.define("l-dot-pulse", class extends DotPulse {});
})();
