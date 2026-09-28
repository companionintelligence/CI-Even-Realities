import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Button,
  ScrollArea,
} from '@companionintelligence/ui';

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BACKEND_KINDS = [
  { kind: 'openai', desc: 'Any OpenAI-compatible URL — OpenAI, Anthropic, Gemini, etc. Hub optional.' },
  { kind: 'local-llm', desc: 'Ollama / vLLM / llama.cpp on your LAN — Hermes, Llama, Qwen…' },
  { kind: 'claude-cli', desc: 'agent-hub spawning Claude Code — supports permission prompts, ring-approved.' },
  { kind: 'codex-cli', desc: 'agent-hub spawning Codex CLI — same permission-prompt flow as Claude.' },
  { kind: 'openclaw', desc: 'agent-hub forwarding to an OpenClaw Gateway.' },
  { kind: 'memory', desc: 'Recalls from Companion Memory (CI-Server) and streams the block back.' },
];

const MANUAL_CONFIG = [
  { field: 'Backend URL', value: 'http://localhost:8080' },
  { field: 'API Key', value: 'ci-local-key' },
  { field: 'Model', value: 'ci-companion' },
  { field: 'API Mode', value: 'auto — probes the server, or force completions / responses' },
];

function copy(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {});
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[85vh] w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Help</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="how" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="overflow-x-auto px-5 pt-3">
            <TabsList>
              <TabsTrigger value="how">How it works</TabsTrigger>
              <TabsTrigger value="shots">Screenshots</TabsTrigger>
              <TabsTrigger value="manual">Manual config</TabsTrigger>
              <TabsTrigger value="backends">Backends</TabsTrigger>
              <TabsTrigger value="trouble">Troubleshooting</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="max-h-[65vh] px-5 py-4">
            <TabsContent value="how" className="mt-0 space-y-3 text-sm">
              <p className="text-muted-foreground">
                One glasses app, one wire contract — the backend you pick is a swap, not a
                rewrite.
              </p>
              <ol className="ml-4 list-decimal space-y-1.5 text-sm">
                <li>The G2's BLE mic captures your voice; the phone app transcribes it.</li>
                <li>
                  The app sends your question to whichever backend you picked in Settings — a
                  direct OpenAI-compatible URL, or your CI-Hub via <code>agent-hub</code>.
                </li>
                <li>
                  Your AI (Ollama, Claude Code, Codex, OpenClaw, OpenAI, or Companion Memory)
                  streams a reply back.
                </li>
                <li>The reply is paginated onto the G2's MicroLED HUD as it arrives.</li>
              </ol>
            </TabsContent>

            <TabsContent value="shots" className="mt-0 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <figure className="text-center">
                <img
                  src="/assets/screenshot-chat.png"
                  alt="CI Companion Chat tab — quick-prompt chips, glasses-display preview, and mic dock"
                  className="mx-auto mb-2 max-w-full rounded-lg border border-border"
                  loading="lazy"
                />
                <figcaption className="text-xs text-muted-foreground">
                  Chat — quick prompts, live glasses preview, mic dock
                </figcaption>
              </figure>
              <figure className="text-center">
                <img
                  src="/assets/screenshot-settings.png"
                  alt="CI Companion Settings tab — Backend Kind picker"
                  className="mx-auto mb-2 max-w-full rounded-lg border border-border"
                  loading="lazy"
                />
                <figcaption className="text-xs text-muted-foreground">
                  Settings — pick a Backend Kind, then set its URL
                </figcaption>
              </figure>
            </TabsContent>

            <TabsContent value="manual" className="mt-0 space-y-3 text-sm">
              <p className="text-muted-foreground">
                For bringing your own OpenAI-compatible endpoint instead of a CI-Hub.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MANUAL_CONFIG.map((row) => (
                    <TableRow key={row.field}>
                      <TableCell className="font-medium">{row.field}</TableCell>
                      <TableCell className="font-mono text-xs">{row.value}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => copy(row.value)}>
                          Copy
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Running the companion <code>agent-hub</code> instead (Claude Code, Codex CLI, or
                OpenClaw)? Point Backend URL at its address (default port <code>8787</code>) and
                pick the matching Backend Kind in Settings.
              </p>
            </TabsContent>

            <TabsContent value="backends" className="mt-0 space-y-2 text-sm">
              <p className="text-muted-foreground">
                The app speaks one OpenAI-compatible wire; the Backend Kind tells it what to
                expect on the other end.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {BACKEND_KINDS.map((b) => (
                  <div key={b.kind} className="rounded-md border border-border bg-card p-3">
                    <div className="font-mono text-xs font-bold text-primary">{b.kind}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{b.desc}</div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="trouble" className="mt-0">
              <Accordion type="single" collapsible>
                <AccordionItem value="browser-mode">
                  <AccordionTrigger>"Running in browser mode"</AccordionTrigger>
                  <AccordionContent>
                    The app only gets glasses-BLE features inside the Even Hub app or its
                    simulator. Chat, settings, and AI requests still work in a plain browser —
                    only the HUD mirror is unavailable.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="no-hud">
                  <AccordionTrigger>No response on the HUD</AccordionTrigger>
                  <AccordionContent>
                    The phone webview is the source of truth — if the glasses display doesn't
                    update, check the status bar's ⚠ HUD indicator; a BLE hiccup self-clears on
                    the next send.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="stuck">
                  <AccordionTrigger>Still stuck?</AccordionTrigger>
                  <AccordionContent>
                    Open an issue on{' '}
                    <a
                      href="https://github.com/companionintelligence/CI-Even-Realities/issues"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      GitHub
                    </a>{' '}
                    or check the{' '}
                    <a
                      href="https://github.com/companionintelligence/CI-Even-Realities/tree/main/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      full docs
                    </a>
                    .
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
