'use client';

import React, { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Code2, BookOpen } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { cn, copyToClipboard } from '@/lib/utils';

type Lang = 'js' | 'curl' | 'flutter' | 'python';

export default function DocsPage() {
  const { toast } = useToast();
  const [lang, setLang] = useState<Lang>('js');
  const [apiKey, setApiKey] = useState('bb_live_your_project_api_key');
  const [origin, setOrigin] = useState('https://api.myapp.com');
  const [host, setHost] = useState('api.myapp.com');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
      setHost(window.location.host);
    }
    apiFetch<{ apiKeys: Array<{ fullKey: string; status: string }> }>('/api/v1/admin/apikeys')
      .then((res) => {
        const active = res.apiKeys.find((k) => k.status === 'active');
        if (active) setApiKey(active.fullKey);
      })
      .catch(() => {});
  }, []);

  const snippets: Record<Lang, string> = {
    js: `import { Bluebeakend } from '@bluebeakend/js';

const bb = new Bluebeakend({
  apiKey: "${apiKey}",
  authDomain: "${host}",
  projectId: "my-app"
});

// 1. Auth
await bb.auth.signup("user@x.com", "pass123");
await bb.auth.login("user@x.com", "pass123");

// 2. Firestore-style Database
const doc = await bb.db.collection("todos").add({ title: "Buy milk", done: false });
const list = await bb.db.collection("todos").where("done", "==", false).get();
await bb.db.collection("todos").doc(doc.id).update({ done: true });

// 3. Object Storage
const file = await bb.storage.upload(myFile, { folder: "avatars" });
const url = await bb.storage.getUrl(file.id);

// 4. Realtime WebSocket Sync
bb.db.collection("todos").onSnapshot((changes) => console.log(changes));`,

    curl: `# 1. Register a user
curl -X POST "${origin}/api/v1/auth/register" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@x.com","password":"pass123","name":"Alex"}'

# 2. Create a document in "todos"
curl -X POST "${origin}/api/v1/db/todos" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Ship app on BlueBeakend","done":false,"priority":1}'

# 3. Query documents where done == false
curl "${origin}/api/v1/db/todos?where=done==false&orderBy=priority:asc" \\
  -H "X-API-Key: ${apiKey}"

# 4. Upload a file to Storage
curl -X POST "${origin}/api/v1/storage/upload" \\
  -H "X-API-Key: ${apiKey}" \\
  -F "folder=uploads" \\
  -F "file=@./photo.png"`,

    flutter: `import 'package:bluebeakend/bluebeakend.dart';

final bb = Bluebeakend(
  apiKey: '${apiKey}',
  authDomain: '${host}',
  projectId: 'my-flutter-app',
);

// Auth
await bb.auth.signup('user@x.com', 'pass123');
await bb.auth.login('user@x.com', 'pass123');

// Database
final doc = await bb.db.collection('todos').add({'title': 'Buy milk', 'done': false});
final open = await bb.db.collection('todos').where('done', '==', false).get();
await bb.db.collection('todos').doc(doc['id'] as String).update({'done': true});

// Realtime Stream
bb.db.collection('todos').snapshots().listen((event) {
  print('Realtime update: \$event');
});`,

    python: `from bluebeakend import Bluebeakend

bb = Bluebeakend(
    api_key="${apiKey}",
    auth_domain="${host}",
    project_id="my-python-app",
)

# Auth
bb.auth.signup("user@x.com", "pass123")
bb.auth.login("user@x.com", "pass123")

# Database
doc = bb.db.collection("todos").add({"title": "Buy milk", "done": False})
todos = bb.db.collection("todos").where("done", "==", False).get()
bb.db.collection("todos").doc(doc["id"]).update({"done": True})

# Storage
uploaded = bb.storage.upload("./report.pdf", folder="reports")
print("Signed URL:", bb.storage.get_url(uploaded["id"]))`,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Documentation & Client SDKs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pre-filled with your live endpoint and active project API key — copy & paste into your app.
          </p>
        </div>
        <a href="/docs" target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">
            Open Fullscreen Swagger UI <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      </div>

      {/* SDK Quickstart Snippets */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-[#0066FF]" />
            <CardTitle>Quickstart Code Examples</CardTitle>
            <Badge variant="blue">Live Key Injected</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['js', 'JavaScript / TS'],
                ['flutter', 'Flutter (Dart)'],
                ['python', 'Python'],
                ['curl', 'cURL'],
              ] as Array<[Lang, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setLang(key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  lang === key
                    ? 'bg-[#0066FF] text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                {label}
              </button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await copyToClipboard(snippets[lang]);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
                toast('Snippet copied!', { variant: 'success' });
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 border border-slate-800 text-xs font-mono overflow-x-auto leading-relaxed">
            {snippets[lang]}
          </pre>
        </CardContent>
      </Card>

      {/* Embedded Swagger UI */}
      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#0066FF]" />
            <CardTitle>Interactive Swagger OpenAPI Explorer</CardTitle>
          </div>
          <a href="/openapi.json" target="_blank" rel="noreferrer" className="text-xs text-[#0066FF] hover:underline font-mono">
            /openapi.json
          </a>
        </CardHeader>
        <iframe
          src="/docs"
          title="BlueBeakend Swagger UI"
          className="w-full h-[680px] border-0 bg-white"
        />
      </Card>
    </div>
  );
}
