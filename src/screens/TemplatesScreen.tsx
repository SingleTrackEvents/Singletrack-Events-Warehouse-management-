import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { EmptyState, Field, Pill, Sheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, create } from '../db/repo';
import { DESTINATION_LABELS, plural } from '../domain/format';
import type { DestinationType } from '../db/types';
import { DESTINATION_TYPES } from '../db/types';

/** Reusable packlist patterns — the thing that makes the fourth race easy. */
export default function TemplatesScreen() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const templates = useLiveQuery(
    async () => alive(await db.templates.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const counts = useLiveQuery(async () => {
    const lines = alive(await db.templateLines.toArray());
    const map = new Map<string, number>();
    for (const line of lines) map.set(line.templateId, (map.get(line.templateId) ?? 0) + 1);
    return map;
  }, [templates]);

  return (
    <Screen
      title="Templates"
      back="/more"
      actions={
        <button type="button" className="header-btn" aria-label="New template" onClick={() => setCreating(true)}>
          +
        </button>
      }
    >
      <p className="small muted mb-3">
        A template is the standing pattern for a kind of destination. Applying one to a packlist tops
        up quantities rather than duplicating lines, so you can stack a base template and a
        wet-weather extra.
      </p>

      {templates && !templates.length ? (
        <EmptyState
          glyph="📋"
          title="No templates yet"
          body="Build one from your standard aid station and every future race gets quicker."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              New template
            </button>
          }
        />
      ) : null}

      <div className="list">
        {(templates ?? []).map((template) => (
          <Link key={template.id} to={`/templates/${template.id}`} className="row">
            <span className="row-icon">📋</span>
            <span className="row-body">
              <span className="row-title">{template.name}</span>
              <span className="row-sub truncate">{template.description || 'No description'}</span>
            </span>
            <span className="row-end">
              <Pill>{DESTINATION_LABELS[template.appliesTo]}</Pill>
              <div className="tiny muted mt-2">{plural(counts?.get(template.id) ?? 0, 'line')}</div>
            </span>
          </Link>
        ))}
      </div>

      {creating ? (
        <NewTemplateSheet onClose={() => setCreating(false)} onCreated={(id) => navigate(`/templates/${id}`)} />
      ) : null}
    </Screen>
  );
}

function NewTemplateSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<DestinationType>('aid_station');
  const [description, setDescription] = useState('');

  return (
    <Sheet
      title="New template"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              void create(db.templates, {
                name: name.trim(),
                appliesTo,
                description: description.trim(),
              }).then((template) => {
                toast('Template created');
                onCreated(template.id);
              });
            }}
          >
            Create
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              value={name}
              placeholder="Standard aid station"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Applies to" hint="Suggested automatically for destinations of this type.">
          {(id) => (
            <select
              id={id}
              className="select"
              value={appliesTo}
              onChange={(event) => setAppliesTo(event.target.value as DestinationType)}
            >
              {DESTINATION_TYPES.map((option) => (
                <option key={option} value={option}>
                  {DESTINATION_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Description">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
