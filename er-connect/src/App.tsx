import {
  Button,
  Card,
  CardContent,
  Logo,
  StatusPill,
  Input,
  Label,
  Stepper,
  StepTriggerList,
  StepTrigger,
  StepContent,
  AppCard,
  QrCode,
} from '@companionintelligence/ui';
import { useState } from 'react';
import { useConnect } from './auth/useConnect';
import { HelpDialog } from './components/HelpDialog';

const EVEN_HUB_URL = 'https://evenhub.evenrealities.com/';
const RELEASES_URL = 'https://github.com/companionintelligence/CI-Even-Realities/releases';
const GITHUB_URL = 'https://github.com/companionintelligence/CI-Even-Realities';

export function App() {
  const connect = useConnect();
  const [step, setStep] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-5 pb-12 pt-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo variant="mark" size={28} />
          <span className="text-sm font-bold tracking-tight">CI Companion</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
          Help
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-5">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Talk to any AI through your <span className="text-primary">Even Realities G2</span>
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Install CI Companion, sign in, and connect a backend — three steps to your glasses
            talking to an AI.
          </p>
        </div>

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
                  <AppCard
                    name="CI Companion"
                    description="Voice-driven AI for your G2 glasses"
                    icon={<Logo variant="mark" size={40} />}
                    onInstall={() => window.open(EVEN_HUB_URL, '_blank', 'noopener')}
                    installLabel="Get on Even Hub"
                  />
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4 text-center">
                    <p className="text-sm font-medium">Scan to open on your phone</p>
                    <QrCode value={EVEN_HUB_URL} fallback={EVEN_HUB_URL} size={140} />
                    <p className="text-xs text-muted-foreground">Or sideload the latest .ehpk from GitHub</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.open(RELEASES_URL, '_blank', 'noopener')}>
                    Sideload latest .ehpk
                  </Button>
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
                      <p className="mt-2 text-xs text-destructive">{connect.signinError}</p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Once signed in, your Hub below is remembered and reconnects automatically.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="hub-host" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                      CI-Hub host
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="hub-host"
                        value={connect.hubUrl}
                        onChange={(e) => connect.setHubUrl(e.target.value)}
                        placeholder="ci-hub.local or 192.168.1.50"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button size="sm" variant="secondary" onClick={connect.runConnect}>
                        Connect
                      </Button>
                    </div>
                    {connect.connectMessage ? (
                      <div className="mt-2">
                        <StatusPill
                          status={
                            connect.connectStatus === 'ok'
                              ? 'success'
                              : connect.connectStatus === 'error'
                                ? 'destructive'
                                : 'info'
                          }
                          label={connect.connectMessage}
                        />
                      </div>
                    ) : null}
                  </div>

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

      <footer className="mt-8 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          GitHub
        </a>
        <span>·</span>
        <button type="button" className="hover:text-foreground" onClick={() => setHelpOpen(true)}>
          Help
        </button>
      </footer>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
