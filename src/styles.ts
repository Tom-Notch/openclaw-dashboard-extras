/** The stylesheet is inserted only into plugin-owned shadow roots. */
export default String.raw`
:host { display:block; min-width:0; color:var(--text,#17212b); font:14px/1.6 system-ui,sans-serif; }
* { box-sizing:border-box; }
.extras-shell { border:1px solid var(--border,#d5dce3); border-radius:12px; overflow:hidden; background:var(--bg,#fff); }
header { padding:14px 18px; border-bottom:1px solid var(--border,#d5dce3); }
h2,h3,p { margin:0; }
h2 { font-size:16px; letter-spacing:.01em; }
h3 { font-size:13px; font-weight:650; margin-bottom:10px; }
.muted,.message-role { color:var(--text-muted,#64748b); font-size:12px; }
.extras-grid { display:grid; grid-template-columns:minmax(0,1fr); min-width:0; }
.extras-grid.preview-open { grid-template-columns:minmax(0,1.4fr) minmax(250px,1fr); }
.transcript { min-width:0; max-height:72vh; overflow:auto; overscroll-behavior:contain; padding:18px; }
.message { padding:14px 0; border-bottom:1px solid var(--border,#e6eaf0); overflow-wrap:anywhere; }
.message:first-child { padding-top:0; }
.message:last-child { border-bottom:0; }
.message-role { text-transform:uppercase; letter-spacing:.08em; margin-bottom:6px; }
.markdown p { margin:.5em 0; }
.markdown p:first-child { margin-top:0; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--bg-secondary,#f1f4f8); padding:12px; border-radius:6px; max-height:45vh; overflow:auto; }
code,pre { font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
a { color:var(--accent,#1765b6); text-decoration:underline; cursor:pointer; }
button,input { font:inherit; }
button { color:inherit; background:var(--bg-secondary,#eef2f6); border:1px solid var(--border,#cad3de); border-radius:7px; padding:7px 11px; cursor:pointer; }
button:disabled { cursor:default; opacity:.55; }
button:focus-visible,a:focus-visible,input:focus-visible { outline:2px solid var(--accent,#1765b6); outline-offset:2px; }
.preview { min-width:0; border-left:1px solid var(--border,#d5dce3); padding:18px; }
.preview[hidden] { display:none; }
.preview-name { overflow-wrap:anywhere; font-weight:600; margin-bottom:10px; }
.preview-status { font-size:12px; margin:10px 0; }
.preview-error { color:var(--danger,#b42318); }
.preview-actions { display:flex; gap:8px; flex-wrap:wrap; }
.panel-input { display:flex; padding:16px; gap:8px; border-bottom:1px solid var(--border,#d5dce3); }
.panel-input input { min-width:0; flex:1; padding:8px; color:inherit; background:var(--bg,#fff); border:1px solid var(--border,#cad3de); border-radius:6px; }
.panel-only .preview { border-left:0; }
details { margin:8px 0; }
summary { cursor:pointer; }
.stream { border-left:3px solid var(--accent,#1765b6); padding-left:12px; }
.loading { padding:8px 0; }
table { border-collapse:collapse; display:block; overflow:auto; max-width:100%; }
td,th { padding:6px 10px; border:1px solid var(--border,#d5dce3); }
math { font-size:1.1em; }
.katex-block,math[display="block"] { display:block; overflow-x:auto; padding:10px 0; text-align:center; }
@media(max-width:720px) { .extras-grid.preview-open { grid-template-columns:minmax(0,1fr); } .preview { border-left:0; border-top:1px solid var(--border,#d5dce3); } .transcript { max-height:60vh; } }
`;
