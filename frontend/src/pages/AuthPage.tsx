import { Bot, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AuthUser } from '../types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: {
            client_id: string;
            callback: (res: { credential?: string }) => void;
          }) => void;
          renderButton: (
            el: HTMLElement,
            opts: Record<string, unknown>
          ) => void;
        };
      };
    };
  }
}

interface Props {
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<{ googleClientId: string | null }>('/auth/config')
      .then((res) => setGoogleClientId(res.googleClientId))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;

    const initGoogle = () => {
      if (!window.google || !googleBtnRef.current) return;
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          if (!response.credential) return;
          setLoading(true);
          setError(null);
          try {
            const res = await api.post<{ user: AuthUser }>('/auth/google', {
              credential: response.credential,
            });
            onAuthenticated(res.user);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'Erro ao autenticar com Google.'
            );
          } finally {
            setLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 340,
        text: 'continue_with',
        shape: 'pill',
        locale: 'pt-BR',
      });
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const existing = document.getElementById('google-gsi-script');
    if (existing) {
      existing.addEventListener('load', initGoogle);
      return () => existing.removeEventListener('load', initGoogle);
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, [googleClientId, onAuthenticated]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
      const payload =
        mode === 'register' ? { name, email, password } : { email, password };
      const res = await api.post<{ user: AuthUser }>(endpoint, payload);
      onAuthenticated(res.user);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao realizar autenticação.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
            <Bot className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
            ZapFlow AI
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Cada conta possui seu próprio WhatsApp, chave de IA, conversas e campanhas 100% isolados.
          </p>
        </div>

        {/* Botão Google OAuth (exibido automaticamente quando GOOGLE_CLIENT_ID está configurado) */}
        {googleClientId && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div ref={googleBtnRef} />
            </div>
            <div className="relative flex items-center justify-center">
              <div className="w-full border-t border-slate-800" />
              <span className="bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500">
                ou com e-mail
              </span>
              <div className="w-full border-t border-slate-800" />
            </div>
          </div>
        )}

        {/* Abas Entrar / Criar Conta */}
        <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`rounded-lg py-2 transition ${
              mode === 'login'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`rounded-lg py-2 transition ${
              mode === 'register'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Seu Nome
              </label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute top-3 left-3.5 h-4 w-4 text-slate-500" />
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: André Luiz"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-3.5 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              E-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-3 left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-3.5 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Senha
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-3 left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-3.5 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading
              ? 'Autenticando...'
              : mode === 'register'
                ? 'Criar Conta Isolada'
                : 'Entrar no Painel'}
          </button>
        </form>

        <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Acesso protegido por sessão criptografada HttpOnly. Nenhum usuário enxerga o WhatsApp, conversas ou chave de IA de outra conta.
          </span>
        </div>
      </div>
    </div>
  );
}
