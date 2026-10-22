import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  StatusPill,
  Input,
  Label,
  Stepper,
  StepTriggerList,
  StepTrigger,
  StepContent,
} from '@companionintelligence/ui';
import { useCallback, useState, type ComponentType, type FormEvent } from 'react';
import { returnedFromSignIn, useConnect } from './auth/useConnect';
import type { HelpDialogProps } from './components/HelpDialog';
import {
  BUY_LABEL,
  BUY_URL,
  CI_SITE_URL,
  DISCORD_URL,
  DOCS_INSTALL_URL,
  DOCS_URL,
  DOWNLOAD_LABEL,
  DOWNLOAD_URL,
  PRIVACY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from './links';

// The Help dialog (Dialog, Tabs, Table, Accordion, ScrollArea, two screenshots) is
// only needed once someone opens it, so it is fetched on demand. This page also
// loads in restrictive webviews: keep the first paint small.
const loadHelp = () => import('./components/HelpDialog');

const SKIP_LINK = 'sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground';
const FOCUS_RING = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const TEXT_LINK = `underline underline-offset-4 hover:text-foreground ${FOCUS_RING}`;
const FOOTER_LINK = `inline-flex min-h-11 items-center px-2.5 underline-offset-4 hover:text-foreground hover:underline ${FOCUS_RING}`;

// index.html carries a static copy of the header, hero, callouts and footer so
// the page has content before (and without) JavaScript. Keep the two in step;
// scripts/check-dist.mjs fails the build if the links or button classes diverge.
const FOOTER_LINKS = [
  { href: CI_SITE_URL, label: 'Companion Intelligence' },
  { href: BUY_URL, label: BUY_LABEL },
  { href: DOWNLOAD_URL, label: DOWNLOAD_LABEL },
  { href: DOCS_URL, label: 'Docs' },
  { href: SUPPORT_URL, label: 'Support' },
  { href: PRIVACY_URL, label: 'Privacy' },
  { href: TERMS_URL, label: 'Terms' },
];

export function App() {
  const connect = useConnect();
  // Coming back from the sign-in service, land on the Connect step: that is where
  // the signed-in state (or the error) is shown.
  const [step, setStep] = useState(returnedFromSignIn ? 1 : 0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [Help, setHelp] = useState<ComponentType<HelpDialogProps> | null>(null);
  const [helpFailed, setHelpFailed] = useState(false);

  const preloadHelp = useCallback(() => {
    loadHelp().catch(() => {});
  }, []);

  const openHelp = useCallback(() => {
    setHelpFailed(false);
    if (Help) {
      setHelpOpen(true);
      return;
    }
    loadHelp()
      .then((m) => {
        setHelp(() => m.HelpDialog);
        setHelpOpen(true);
      })
      .catch(() => setHelpFailed(true));
  }, [Help]);

  const onHubSubmit = (event: FormEvent) => {
    event.preventDefault();
    connect.runConnect();
  };

  return (
    <div className="ci-page">
      <a href="#main" className={SKIP_LINK}>
        Skip to main content
      </a>
      <header className="mb-8 flex items-center justify-between gap-3">
        <a href={CI_SITE_URL} title="Companion Intelligence" className={`ci-brand -m-1 p-1 ${FOCUS_RING}`}>
          <img src="/assets/ci-logo-white-banner.svg" width={139} height={44} alt="Companion Intelligence" className="ci-logo" />
        </a>
        <nav aria-label="Page" className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={openHelp} onPointerEnter={preloadHelp} onFocus={preloadHelp}>
            Help
          </Button>
          <a className={buttonVariants({ variant: 'default', size: 'sm' })} href={DOCS_URL}>
            Docs
          </a>
        </nav>
      </header>

      {helpFailed ? (
        <p role="status" className="mb-5 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          Help couldn&apos;t load. Check your connection, or read the same information in the{' '}
          <a className={TEXT_LINK} href={DOCS_URL}>
            docs
          </a>
          .
        </p>
      ) : null}

      <main id="main" tabIndex={-1} className="flex flex-1 flex-col gap-5 focus:outline-none">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Talk to any AI through your <span className="text-primary">Even Realities G2</span>
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Set up CI Companion, sign in, and connect a backend: three steps to your glasses talking
            to an AI.
          </p>
          <div className="mx-auto mt-4 grid max-w-sm grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <a className={buttonVariants({ variant: 'default' })} href={BUY_URL}>
              {BUY_LABEL}
            </a>
            <a className={buttonVariants({ variant: 'outline' })} href={DOWNLOAD_URL}>
              {DOWNLOAD_LABEL}
            </a>
          </div>
          <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
            Companion Core: a private, cloud-free AI lab. Companion Hub: turn any computer into a
            home AI hub.
          </p>
        </div>

        <h2 className="sr-only">Set up CI Companion</h2>
        <Card>
          <CardContent className="p-4">
            <Stepper currentStep={step}>
              <StepTriggerList className="mb-5">
                <StepTrigger step={0} title="Install" onStepChange={setStep} alwaysClickable />
                <StepTrigger step={1} title="Connect" onStepChange={setStep} alwaysClickable />
                <StepTrigger step={2} title="Talk" onStepChange={setStep} alwaysClickable />
              </StepTriggerList>

              <StepContent step={0}>
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <Badge variant="secondary">Developer preview</Badge>
                    <h3 className="mt-3 text-base font-bold">Not in the Even Hub store yet</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The CI Companion glasses app has no public download or store listing yet, so
                      there is nothing to install from this page. (Download Companion above is
                      Companion Hub, a separate app, not the glasses app.) If Companion
                      Intelligence has given you access, follow the install steps in the docs. To
                      ask about access or follow progress, join the Discord.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={DOCS_INSTALL_URL}>
                      Read the install steps
                    </a>
                    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={DISCORD_URL}>
                      Ask for access on Discord
                    </a>
                  </div>
                  <Button size="sm" onClick={() => setStep(1)}>
                    Next: connect a backend
                  </Button>
                </div>
              </StepContent>

              <StepContent step={1}>
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Sign in
                      </Label>
                      {connect.identity ? (
                        <StatusPill status="success" label={connect.identity.name ?? 'Signed in'} />
                      ) : null}
                    </div>
                    {connect.identity ? (
                      <Button variant="outline" size="sm" onClick={connect.signOut}>
                        Sign out
                      </Button>
                    ) : (
                      <Button size="sm" disabled={connect.signinBusy} onClick={connect.signIn}>
                        Sign in with Companion Intelligence
                      </Button>
                    )}
                    {connect.signinError ? (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        {connect.signinError}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sign in with your CI Account. Your Companion Hub address below is
                        remembered in this browser.
                      </p>
                    )}
                  </div>

                  <form onSubmit={onHubSubmit} noValidate>
                    <Label htmlFor="hub-host" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                      Companion Hub address
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        className="flex-1"
                        id="hub-host"
                        name="hub-host"
                        value={connect.hubUrl}
                        onChange={(e) => connect.setHubUrl(e.target.value)}
                        placeholder="ci-hub.local or 192.168.1.50"
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        enterKeyHint="go"
                        spellCheck={false}
                      />
                      <Button type="submit" size="sm" variant="secondary">
                        Connect
                      </Button>
                    </div>
                    {connect.connectMessage ? (
                      <div className="mt-2">
                        <StatusPill
                          className="h-auto max-w-full whitespace-normal break-all text-left"
                          status={
                            connect.connectStatus === 'ok'
                              ? 'success'
                              : connect.connectStatus === 'error'
                                ? 'destructive'
                                : 'info'
                          }
                          label={connect.connectMessage}
                        />
                        {connect.connectStatus === 'unverified' ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Browsers can&apos;t test a plain-http host from this page — that&apos;s
                            expected. Open CI Companion in the Even app and tap{' '}
                            <strong>Quick connect</strong> to finish.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>No Companion Hub yet?</span>
                      <a className={`${TEXT_LINK} py-1`} href={BUY_URL}>
                        {BUY_LABEL}
                      </a>
                      <a className={`${TEXT_LINK} py-1`} href={DOWNLOAD_URL}>
                        {DOWNLOAD_LABEL}
                      </a>
                    </p>
                  </form>

                  <Button size="sm" onClick={() => setStep(2)}>
                    Next: start talking
                  </Button>
                </div>
              </StepContent>

              <StepContent step={2}>
                <div className="flex flex-col gap-3 text-sm">
                  <p>
                    Long-press the G2 touchbar (or tap the mic in-app) to ask a question. The
                    answer streams onto the HUD as it arrives.
                  </p>
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Ring:</strong> tap = next page / deny
                    prompt · double-tap = clear conversation / approve prompt.
                  </p>
                </div>
              </StepContent>
            </Stepper>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-10 border-t border-border pt-3 text-xs text-muted-foreground">
        <nav aria-label="Companion Intelligence" className="flex flex-wrap items-center justify-center">
          {FOOTER_LINKS.map((link) => (
            <a key={link.href} className={FOOTER_LINK} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <p className="mt-2 text-center">
          This page remembers your Companion Hub address in this browser and keeps your sign-in only
          while this tab is open.
          {__GA_ENABLED__ ? ' It uses Google Analytics to count visits; see Privacy.' : ''}
        </p>
      </footer>

      {Help ? <Help open={helpOpen} onOpenChange={setHelpOpen} /> : null}
    </div>
  );
}
