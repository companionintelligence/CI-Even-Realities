import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { DISCORD_URL, DOCS_TROUBLESHOOTING_URL, DOCS_URL, SUPPORT_URL } from '../links';

const LINK = 'rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BACKEND_KINDS = [
  { kind: 'openai', desc: 'Any OpenAI-compatible URL — OpenAI, Anthropic, Gemini, etc. Hub optional.' },
  { kind: 'local-llm', desc: 'Ollama / vLLM / llama.cpp on your LAN — Hermes, Llama, Qwen…' },
  { kind: 'claude-cli', desc: 'agent-hub spawning Claude Code — supports permission prompts, ring-approved.' },
  { kind: 'codex-cli', desc: 'agent-hub spawning Codex CLI — same permission-prompt flow as Claude.' },
  { kind: 'openclaw', desc: 'agent-hub forwarding to an OpenClaw Gateway.' },
  { kind: 'memory', desc: 'Recalls from Companion Memory and streams the block back.' },
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
          <DialogDescription className="sr-only">
            How CI Companion works, screenshots, manual setup, backend kinds and troubleshooting.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="how" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="px-5 pt-3">
            {/* Wraps on a phone instead of scrolling sideways and clipping the last tabs. */}
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger className="h-8 flex-none" value="how">How it works</TabsTrigger>
              <TabsTrigger className="h-8 flex-none" value="shots">Screenshots</TabsTrigger>
              <TabsTrigger className="h-8 flex-none" value="manual">Manual config</TabsTrigger>
              <TabsTrigger className="h-8 flex-none" value="backends">Backends</TabsTrigger>
              <TabsTrigger className="h-8 flex-none" value="trouble">Troubleshooting</TabsTrigger>
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
                  direct OpenAI-compatible URL, or your Companion Hub via <code>agent-hub</code>.
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
                  src="/assets/screenshot-chat.webp"
                  alt="CI Companion Chat tab — quick-prompt chips, glasses-display preview, and mic dock"
                  width={600}
                  height={772}
                  className="mx-auto mb-2 h-auto w-full max-w-[16rem] rounded-lg border border-border"
                  loading="lazy"
                  decoding="async"
                />
                <figcaption className="text-xs text-muted-foreground">
                  Chat — quick prompts, live glasses preview, mic dock
                </figcaption>
              </figure>
              <figure className="text-center">
                <img
                  src="/assets/screenshot-settings.webp"
                  alt="CI Companion Settings tab — Backend Kind picker"
                  width={600}
                  height={772}
                  className="mx-auto mb-2 h-auto w-full max-w-[16rem] rounded-lg border border-border"
                  loading="lazy"
                  decoding="async"
                />
                <figcaption className="text-xs text-muted-foreground">
                  Settings — pick a Backend Kind, then set its URL
                </figcaption>
              </figure>
            </TabsContent>

            <TabsContent value="manual" className="mt-0 space-y-3 text-sm">
              <p className="text-muted-foreground">
                For bringing your own OpenAI-compatible endpoint instead of a Companion Hub.
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
                <AccordionItem value="cant-verify">
                  <AccordionTrigger>Connect says "Saved… can't test a plain-http host"</AccordionTrigger>
                  <AccordionContent>
                    That's expected, not an error. Your hub's <code>agent-hub</code> is plain{' '}
                    <code>http://host:8787</code>, and browsers won't make plain-http requests
                    from an https page, so this page can't check it. The host is saved — open CI
                    Companion in the Even app, go to Settings → CI-Hub, and tap a Quick connect
                    preset to verify the connection for real.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              {/* Outside the accordion on purpose: these links must be in the DOM and visible
                  without expanding anything first. */}
              <p className="mt-4 text-sm text-muted-foreground">
                Still stuck? Read the{' '}
                <a href={DOCS_TROUBLESHOOTING_URL} className={LINK}>
                  troubleshooting guide
                </a>{' '}
                or the{' '}
                <a href={DOCS_URL} className={LINK}>
                  full docs
                </a>
                , contact{' '}
                <a href={SUPPORT_URL} className={LINK}>
                  Companion Intelligence support
                </a>
                , or ask in the{' '}
                <a href={DISCORD_URL} className={LINK}>
                  Discord
                </a>
                .
              </p>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
