import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function writeApplicationHtml(root: string, id: string): void {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#18202a;font:14px system-ui}
    .application-shell{max-width:1180px;margin:auto;padding:20px}
    header,.actions,.metrics,.workspace,.toolbar{display:flex;gap:12px}
    header{align-items:center;justify-content:space-between}h1,h2,p{margin:0}
    button,input{font:inherit}nav button,.toolbar span{display:inline-block;margin-left:8px;padding:7px 10px;border:0;border-radius:8px;background:#e6e9ee}
    nav .active{background:#1d4ed8;color:white}.metrics{margin:18px 0}
    .actions{align-items:center;margin-top:16px}.actions input{padding:7px 10px}
    .metrics article{flex:1;padding:14px;border-radius:10px;background:white}
    .metrics strong{display:block;font-size:20px}.toolbar{margin-bottom:10px}
    .workspace{align-items:flex-start}#ticket-list{flex:1;min-width:0;margin:0;padding:0;list-style:none}
    #ticket-list li{display:grid;grid-template-columns:1fr 110px 100px 42px;gap:10px;padding:8px 10px;border-bottom:1px solid #e5e7eb;background:white}
    .inspect-ticket{border:0;background:transparent;text-align:left}
    #ticket-list li.selected{background:#dbeafe}#ticket-detail{width:290px;padding:16px;background:white;border-radius:10px}
    #report-view{padding:20px;background:white;border-radius:10px}#report-view li{display:flex;justify-content:space-between;padding:8px}
  </style>
</head>
<body>
  <bench-root id="app"></bench-root>
  <script src="./${id}.js"></script>
</body>
</html>
`;
  writeFileSync(resolve(root, `dist/${id}.html`), html, 'utf8');
}
