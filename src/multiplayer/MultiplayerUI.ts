/**
 * MultiplayerUI - Simple UI for multiplayer connection setup
 * Allows users to create/join sessions by exchanging connection codes
 */

export class MultiplayerUI {
  private container: HTMLDivElement;
  private onHostCallback?: () => Promise<string>;
  private onJoinCallback?: (offer: string) => Promise<string>;
  private onAnswerCallback?: (answer: string) => Promise<void>;
  
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'multiplayer-ui';
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '20px',
      borderRadius: '12px',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      zIndex: '1000',
      maxWidth: '350px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      display: 'none' // Hidden by default
    });
    
    document.body.appendChild(this.container);
    this.render();
  }
  
  private render(): void {
    this.container.innerHTML = `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: #4ECDC4;">🎮 Multiplayer</h3>
        <p style="margin: 0; opacity: 0.8; font-size: 12px;">
          Share XR experiences with a friend!
        </p>
      </div>
      
      <div style="margin-bottom: 15px;">
        <button id="mp-host-btn" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          transition: transform 0.2s;
        ">
          🏠 Host Session
        </button>
      </div>
      
      <div style="margin-bottom: 15px;">
        <button id="mp-join-btn" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          transition: transform 0.2s;
        ">
          🎮 Join Session
        </button>
      </div>
      
      <div id="mp-connection-area" style="display: none;">
        <textarea id="mp-input" style="
          width: 100%;
          height: 80px;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #4ECDC4;
          background: rgba(255,255,255,0.1);
          color: white;
          font-family: monospace;
          font-size: 11px;
          resize: none;
          margin-bottom: 10px;
        " placeholder="Paste connection code here..."></textarea>
        
        <button id="mp-copy-btn" style="
          width: 100%;
          padding: 8px;
          background: #4ECDC4;
          border: none;
          border-radius: 6px;
          color: black;
          font-size: 12px;
          font-weight: bold;
          cursor: pointer;
          margin-bottom: 5px;
        ">
          📋 Copy Code
        </button>
        
        <button id="mp-submit-btn" style="
          width: 100%;
          padding: 8px;
          background: #27ae60;
          border: none;
          border-radius: 6px;
          color: white;
          font-size: 12px;
          font-weight: bold;
          cursor: pointer;
        ">
          ✅ Connect
        </button>
      </div>
      
      <div id="mp-status" style="
        margin-top: 15px;
        padding: 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        font-size: 12px;
        text-align: center;
        display: none;
      "></div>
      
      <button id="mp-close-btn" style="
        position: absolute;
        top: 10px;
        right: 10px;
        background: transparent;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        opacity: 0.6;
      ">✕</button>
    `;
    
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    const hostBtn = document.getElementById('mp-host-btn');
    const joinBtn = document.getElementById('mp-join-btn');
    const copyBtn = document.getElementById('mp-copy-btn');
    const submitBtn = document.getElementById('mp-submit-btn');
    const closeBtn = document.getElementById('mp-close-btn');
    const input = document.getElementById('mp-input') as HTMLTextAreaElement;
    
    hostBtn?.addEventListener('click', async () => {
      this.showStatus('Creating session...', 'yellow');
      const offer = await this.onHostCallback?.();
      if (offer) {
        input.value = offer;
        this.showConnectionArea();
        this.showStatus('📤 Share this code with your friend!', '#4ECDC4');
      }
    });
    
    joinBtn?.addEventListener('click', () => {
      this.showConnectionArea();
      this.showStatus('📥 Paste the host\'s code and click Connect', '#f5576c');
    });
    
    copyBtn?.addEventListener('click', () => {
      input.select();
      document.execCommand('copy');
      this.showStatus('✅ Copied to clipboard!', '#27ae60');
    });
    
    submitBtn?.addEventListener('click', async () => {
      const code = input.value.trim();
      if (!code) {
        this.showStatus('❌ Please paste a code first', 'red');
        return;
      }
      
      try {
        this.showStatus('Connecting...', 'yellow');
        
        // Check if this is an offer (host code) or answer (guest response)
        const data = JSON.parse(code);
        
        if (data.type === 'offer') {
          // Guest joining - create answer
          const answer = await this.onJoinCallback?.(code);
          if (answer) {
            input.value = answer;
            this.showStatus('📤 Send this answer back to the host!', '#4ECDC4');
          }
        } else if (data.type === 'answer') {
          // Host receiving answer
          await this.onAnswerCallback?.(code);
          this.showStatus('✅ Connecting...', '#27ae60');
        }
      } catch (error) {
        this.showStatus('❌ Invalid code format', 'red');
        console.error('[MultiplayerUI] Error:', error);
      }
    });
    
    closeBtn?.addEventListener('click', () => {
      this.hide();
    });
  }
  
  private showConnectionArea(): void {
    const area = document.getElementById('mp-connection-area');
    if (area) area.style.display = 'block';
  }
  
  private showStatus(message: string, color: string): void {
    const status = document.getElementById('mp-status');
    if (status) {
      status.textContent = message;
      status.style.display = 'block';
      status.style.color = color;
    }
  }
  
  show(): void {
    this.container.style.display = 'block';
  }
  
  hide(): void {
    this.container.style.display = 'none';
  }
  
  onHost(callback: () => Promise<string>): void {
    this.onHostCallback = callback;
  }
  
  onJoin(callback: (offer: string) => Promise<string>): void {
    this.onJoinCallback = callback;
  }
  
  onAnswer(callback: (answer: string) => Promise<void>): void {
    this.onAnswerCallback = callback;
  }
  
  setConnectionStatus(connected: boolean): void {
    if (connected) {
      this.showStatus('🎉 CONNECTED! Have fun!', '#27ae60');
      setTimeout(() => this.hide(), 2000);
    } else {
      this.showStatus('❌ Disconnected', 'red');
    }
  }
}

