import {
  Edit3,
  Globe,
  Layers,
  Plus,
  Tag as TagIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AiRule, Contact, Tag } from '../types';

const SCOPE_META = {
  CONTACT: {
    label: '1º Individual (Prioridade Máxima)',
    short: 'Individual',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: User,
  },
  TAG: {
    label: '2º Grupo / Tag',
    short: 'Grupo/Tag',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: TagIcon,
  },
  GLOBAL: {
    label: '3º Global (Padrão)',
    short: 'Global',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: Globe,
  },
};

export function RulesPage() {
  const [rules, setRules] = useState<AiRule[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filterScope, setFilterScope] = useState<'ALL' | 'CONTACT' | 'TAG' | 'GLOBAL'>('ALL');

  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10b981');

  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AiRule | null>(null);
  const [form, setForm] = useState({
    name: '',
    scope: 'GLOBAL' as 'GLOBAL' | 'TAG' | 'CONTACT',
    isActive: true,
    tagId: '',
    contactId: '',
    contactPhone: '',
    contactName: '',
    objective: '',
    toneOfVoice: '',
    knowledgeBase: '',
    stopCondition: '',
  });

  const loadData = async () => {
    try {
      const data = await api.get<{
        rules: AiRule[];
        tags: Tag[];
        contacts: Contact[];
      }>('/rules');
      setRules(data.rules);
      setTags(data.tags);
      setContacts(data.contacts);
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openCreate = (scope: 'GLOBAL' | 'TAG' | 'CONTACT' = 'GLOBAL') => {
    setEditingRule(null);
    setForm({
      name: '',
      scope,
      isActive: true,
      tagId: tags[0]?.id || '',
      contactId: '',
      contactPhone: '',
      contactName: '',
      objective: '',
      toneOfVoice: 'Cordial, natural, conciso e prestativo no estilo WhatsApp.',
      knowledgeBase: '',
      stopCondition:
        'Se o cliente pedir para falar com humano, reclamar de pagamento ou quiser negociação especial.',
    });
    setShowModal(true);
  };

  const openEdit = (rule: AiRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      scope: rule.scope,
      isActive: rule.isActive,
      tagId: rule.tagId || '',
      contactId: rule.contactId || '',
      contactPhone: rule.contact?.phone || '',
      contactName: rule.contact?.name || '',
      objective: rule.objective,
      toneOfVoice: rule.toneOfVoice,
      knowledgeBase: rule.knowledgeBase,
      stopCondition: rule.stopCondition,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editingRule) {
        await api.put(`/rules/${editingRule.id}`, form);
      } else {
        await api.post('/rules', form);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar regra.');
    }
  };

  const handleToggleActive = async (rule: AiRule) => {
    await api.put(`/rules/${rule.id}`, { isActive: !rule.isActive });
    await loadData();
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Deseja excluir esta regra de IA?')) return;
    await api.del(`/rules/${id}`);
    await loadData();
  };

  const handleAddTag = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      await api.post('/rules/tags', { name: newTagName.trim(), color: newTagColor });
      setNewTagName('');
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao criar tag.');
    }
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('Excluir este grupo/tag?')) return;
    await api.del(`/rules/tags/${id}`);
    await loadData();
  };

  const filteredRules = rules.filter((r) =>
    filterScope === 'ALL' ? true : r.scope === filterScope
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Fluxos e Personas da IA
          </h2>
          <p className="text-sm text-slate-400">
            Configure o comportamento da IA em 3 níveis de prioridade: Individual &gt; Grupo/Tag &gt; Global.
          </p>
        </div>
        <button
          onClick={() => openCreate('TAG')}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          Nova Regra / Persona
        </button>
      </div>

      {/* Explicação Visual da Hierarquia */}
      <div className="grid gap-3 md:grid-cols-3">
        {(['CONTACT', 'TAG', 'GLOBAL'] as const).map((scope) => {
          const meta = SCOPE_META[scope];
          const Icon = meta.icon;
          return (
            <div
              key={scope}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">{meta.label}</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                {scope === 'CONTACT' &&
                  'Sobrescreve todas as outras regras para um número ou cliente específico.'}
                {scope === 'TAG' &&
                  'Aplica-se a contatos marcados com um grupo/tag (ex: Leads, VIP, Suporte).'}
                {scope === 'GLOBAL' &&
                  'Regra padrão aplicada automaticamente a todas as conversas sem regra específica.'}
              </p>
            </div>
          );
        })}
      </div>

      {/* Gestão de Grupos / Tags */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <TagIcon className="h-4 w-4 text-emerald-400" />
            Grupos / Tags de Contatos
          </h3>
          <form onSubmit={handleAddTag} className="flex items-center gap-2">
            <input
              type="color"
              value={newTagColor}
              onChange={(e) => setNewTagColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded border border-slate-700 bg-slate-950"
            />
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Novo grupo (ex: Pós-Venda)"
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
            />
            <button
              type="submit"
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              Adicionar
            </button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
              <span className="text-slate-500">({tag._count?.contacts ?? 0})</span>
              <button
                onClick={() => handleDeleteTag(tag.id)}
                className="text-slate-500 hover:text-rose-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Filtros + Lista de Regras */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'ALL', label: 'Todas as Regras' },
            { id: 'CONTACT', label: '1º Individual' },
            { id: 'TAG', label: '2º Por Grupo/Tag' },
            { id: 'GLOBAL', label: '3º Global' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterScope(tab.id as typeof filterScope)}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                filterScope === tab.id
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {filteredRules.map((rule) => {
            const meta = SCOPE_META[rule.scope];
            return (
              <div
                key={rule.id}
                className={`rounded-2xl border p-5 transition ${
                  rule.isActive
                    ? 'border-slate-800 bg-slate-900/70'
                    : 'border-slate-800/50 bg-slate-900/30 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}
                      >
                        {meta.short}
                      </span>
                      {rule.scope === 'TAG' && rule.tag && (
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-200">
                          Tag: {rule.tag.name}
                        </span>
                      )}
                      {rule.scope === 'CONTACT' && rule.contact && (
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-200">
                          {rule.contact.name || rule.contact.phone} (+{rule.contact.phone})
                        </span>
                      )}
                    </div>
                    <h4 className="mt-2 text-base font-bold text-white">
                      {rule.name}
                    </h4>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleActive(rule)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        rule.isActive
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {rule.isActive ? 'Ativa' : 'Pausada'}
                    </button>
                    <button
                      onClick={() => openEdit(rule)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5 text-xs">
                  <div>
                    <span className="font-semibold text-slate-400">Objetivo:</span>
                    <p className="mt-0.5 text-slate-200">{rule.objective}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-400">Tom de voz:</span>
                    <p className="mt-0.5 text-slate-300">{rule.toneOfVoice}</p>
                  </div>
                  {rule.knowledgeBase && (
                    <div>
                      <span className="font-semibold text-slate-400">
                        Contexto / Base de Conhecimento:
                      </span>
                      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-slate-300">
                        {rule.knowledgeBase}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-amber-300/90">
                      Condição de Parada (Transferir p/ Humano):
                    </span>
                    <p className="mt-0.5 text-slate-300">{rule.stopCondition}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal Criar / Editar Regra */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleSubmit}
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <Layers className="h-5 w-5 text-emerald-400" />
                {editingRule ? 'Editar Regra de IA' : 'Nova Regra / Persona de IA'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Nome da Regra / Fluxo
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Qualificação de Leads"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Nível de Prioridade
                </label>
                <select
                  value={form.scope}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scope: e.target.value as 'GLOBAL' | 'TAG' | 'CONTACT',
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                >
                  <option value="CONTACT">1º Individual (por número/contato)</option>
                  <option value="TAG">2º Por Grupo / Tag</option>
                  <option value="GLOBAL">3º Global (Padrão)</option>
                </select>
              </div>
            </div>

            {form.scope === 'TAG' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Grupo / Tag Alvo
                </label>
                <select
                  required
                  value={form.tagId}
                  onChange={(e) => setForm({ ...form, tagId: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                >
                  <option value="">Selecione um grupo/tag...</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.scope === 'CONTACT' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Contato existente (opcional)
                  </label>
                  <select
                    value={form.contactId}
                    onChange={(e) =>
                      setForm({ ...form, contactId: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                  >
                    <option value="">Ou digite o número ao lado...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.phone} (+{c.phone})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Número WhatsApp (se novo)
                  </label>
                  <input
                    value={form.contactPhone}
                    onChange={(e) =>
                      setForm({ ...form, contactPhone: e.target.value })
                    }
                    placeholder="5511999998888"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Objetivo da Conversa
              </label>
              <textarea
                required
                rows={2}
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                placeholder="Ex: Qualificar o interesse do lead, coletar orçamento aproximado e agendar reunião."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Tom de Voz
              </label>
              <input
                value={form.toneOfVoice}
                onChange={(e) => setForm({ ...form, toneOfVoice: e.target.value })}
                placeholder="Ex: Consultivo, empático, descontraído e direto."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Informações de Contexto / Base de Conhecimento
              </label>
              <textarea
                rows={4}
                value={form.knowledgeBase}
                onChange={(e) =>
                  setForm({ ...form, knowledgeBase: e.target.value })
                }
                placeholder="Produtos, serviços, FAQ, preços, horários, links úteis..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-amber-300">
                Condição de Parada (Transferir automaticamente para Humano)
              </label>
              <textarea
                rows={2}
                value={form.stopCondition}
                onChange={(e) =>
                  setForm({ ...form, stopCondition: e.target.value })
                }
                placeholder="Ex: Quando o cliente confirmar compra, pedir suporte técnico avançado ou pedir para falar com humano."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Salvar Regra
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
