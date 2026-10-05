import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of the children after an uncaught render error. */
  fallback: ReactNode;
}

/**
 * Keeps one thrown render error from blanking the whole page. The page is also
 * loaded in restrictive webviews, where an unexpected throw (blocked storage, a
 * failed chunk) used to leave nothing on screen at all.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('er-connect render error', error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
