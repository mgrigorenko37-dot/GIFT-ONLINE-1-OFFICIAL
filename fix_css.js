const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
  /* New DUROV_CAP Theme */
  :root {
    --bg: #0B0D12;
    --panel: #12151C;
    --panel-2: #171B24;
    --line: #232733;
    --text: #E9ECF1;
    --muted: #7A8194;
    --muted-2: #4E5566;
    --up: #21D6A0;
    --up-dim: rgba(33,214,160,.12);
    --down: #FF5C7A;
    --down-dim: rgba(255,92,122,.12);
    --gold: #F2B84B;
    --radius: 10px;

    /* Override gx variables just in case */
    --gx-bg: var(--bg);
    --gx-panel: var(--panel);
    --gx-border: var(--line);
    --gx-text: var(--text);
  }

  /* Hide old columns */
  .gx-far-left-column, .gx-center-column {
    display: none !important;
  }

  .mono{ font-family:'JetBrains Mono', monospace; }
  .display{ font-family:'Sora', sans-serif; }

  .topbar{
    display:flex; align-items:center; justify-content:space-between;
    padding: 14px 24px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, #0D1017, #0B0D12);
  }
  .brand{
    display:flex; align-items:center; gap:10px;
  }
  .brand-mark{
    width:26px; height:26px; border-radius:7px;
    background: linear-gradient(135deg, var(--gold), #C98A2C);
    display:flex; align-items:center; justify-content:center;
    font-size:14px;
  }
  .crumbs{ font-size:13px; color:var(--muted); display:flex; gap:6px; align-items:center;}
  .crumbs b{ color:var(--text); font-weight:600; }
  .live-pill{
    font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px;
  }
  .dot{ width:6px; height:6px; border-radius:50%; background:var(--up); box-shadow:0 0 8px var(--up); }

  .layout {
    display: grid !important;
    grid-template-columns: 1fr 340px !important;
    gap: 1px !important;
    background: var(--line) !important;
    flex: 1;
    min-height: 0;
  }
  
  .col { 
    background: var(--bg) !important; 
    min-height: 0;
  }

  .price-head{
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--line);
    display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:16px;
  }
  .asset-name{
    font-size: 12px; letter-spacing:.06em; color:var(--muted); text-transform:uppercase; margin-bottom:6px;
  }
  .asset-price{
    font-size: 34px; font-weight:700; display:flex; align-items:baseline; gap:12px;
  }
  .chg-tag{
    font-size:14px; font-weight:600; padding:3px 8px; border-radius:6px;
  }
  .chg-up{ color:var(--up); background:var(--up-dim); }
  .stats{ display:flex; gap:28px; }
  .stat{ text-align:right; }
  .stat .l{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;}
  .stat .v{ font-size:14px; font-weight:500; }

  .chart-toolbar{
    display:flex; gap:4px; padding: 12px 24px; border-bottom:1px solid var(--line);
  }
  .tf-btn{
    background:none; border:none; color:var(--muted); font-size:12.5px;
    padding:6px 10px; border-radius:6px; cursor:pointer; font-family:'JetBrains Mono',monospace;
    transition: all .15s;
  }
  .tf-btn:hover{ color:var(--text); background:var(--panel-2); }
  .tf-btn.active{ color:var(--bg); background:var(--gold); font-weight:600; }

  .chart-wrap{ padding: 18px 24px 8px; position:relative; }
  .chart-badge{
    position:absolute; top:20px; left:28px;
    font-size:12px; color:var(--muted);
  }

  .panel-inner{ padding: 18px 20px; }
  .side-tabs{
    display:flex; background:var(--panel); border-radius:8px; padding:3px; margin-bottom:16px;
  }
  .side-tab{
    flex:1; text-align:center; padding:9px 0; border-radius:6px; cursor:pointer;
    font-size:13.5px; font-weight:600; color:var(--muted); transition:.15s;
    border: none;
    background: transparent;
  }
  .side-tab.buy.active{ background:var(--up-dim); color:var(--up); }
  .side-tab.sell.active{ background:var(--down-dim); color:var(--down); }

  .type-row{
    display:flex; gap:18px; margin-bottom:16px; border-bottom:1px solid var(--line); padding-bottom:10px;
  }
  .type-item{
    font-size:13px; color:var(--muted-2); cursor:pointer; padding-bottom:8px; position:relative;
    background: none; border: none;
  }
  .type-item.active{ color:var(--text); font-weight:600; }
  .type-item.active::after{
    content:''; position:absolute; left:0; right:0; bottom:-11px; height:2px; background:var(--gold);
  }

  .field{
    background:var(--panel); border:1px solid var(--line); border-radius:8px;
    padding: 10px 12px; margin-bottom:10px;
    display:flex; align-items:center; justify-content:space-between;
    transition:border-color .15s;
  }
  .field:focus-within{ border-color: var(--gold); }
  .field .fl{ font-size:11.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .field input{
    background:none; border:none; outline:none; color:var(--text);
    font-family:'JetBrains Mono',monospace; font-size:15px; text-align:right; width:100%;
  }
  .field .unit{ font-size:12.5px; color:var(--muted-2); margin-left:6px; white-space:nowrap; }

  .slider-row{ margin: 14px 0 18px; }
  input[type=range]{
    -webkit-appearance:none; width:100%; height:3px; border-radius:2px;
    background: linear-gradient(90deg, var(--gold) 0%, var(--gold) var(--val,0%), var(--line) var(--val,0%), var(--line) 100%);
  }
  input[type=range]::-webkit-slider-thumb{
    -webkit-appearance:none; width:14px; height:14px; border-radius:50%;
    background: var(--gold); border:2px solid #0B0D12; cursor:pointer; margin-top:-5.5px;
  }
  .slider-marks{ display:flex; justify-content:space-between; margin-top:8px; }
  .slider-marks span{ font-size:11px; color:var(--muted-2); font-family:'JetBrains Mono',monospace; cursor:pointer; }
  .slider-marks span:hover{ color:var(--gold); }

  .summary{ margin: 6px 0 16px; }
  .sum-row{
    display:flex; justify-content:space-between; font-size:12.5px; padding:5px 0; color:var(--muted);
  }
  .sum-row b{ color:var(--text); font-weight:500; font-family:'JetBrains Mono',monospace; }

  .cta{
    width:100%; border:none; padding:13px; border-radius:8px;
    font-size:14.5px; font-weight:700; cursor:pointer; letter-spacing:.01em;
    transition: filter .15s, transform .1s;
  }
  .cta:active{ transform: scale(.98); }
  .cta.buy{ background: var(--up); color:#062017; }
  .cta.sell{ background: var(--down); color:#2a0510; }
  .cta:hover{ filter:brightness(1.08); }
`;
fs.writeFileSync('src/styles/site.css', css);
