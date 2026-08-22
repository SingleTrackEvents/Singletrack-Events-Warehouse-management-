import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ItemPicker } from '../components/ItemPicker';
import { ConfirmSheet, Pill, Stepper } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, byId, createMany, liveWhere, nextSort, softDelete, softDeleteChildren, update } from '../db/repo';
import { DESTINATION_LABELS, plural } from '../domain/format';
import type { TemplateLine } from '../db/types';

/** Edit one template's contents. Quantities here are the starting point, not a rule. */
export default function TemplateDetailScreen() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const template = useLiveQuery(
    async () => (templateId ? db.templates.get(templateId) : undefined),
    [templateId],
  );
  const lines = useLiveQuery(
    async () => (templateId ? liveWhere(db.templateLines, 'templateId', templateId) : []),
    [templateId],
  );
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);

  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<TemplateLine>();
  const [deleting, setDeleting] = useState(false);

  if (!template) {
    return (
      <Screen title="Template" back="/templates">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  return (
    <Screen
      title={template.name}
      subtitle={DESTINATION_LABELS[template.appliesTo]}
      back="/templates"
    >
      {template.description ? <p className="small muted mb-3">{template.description}</p> : null}
      <p className="small muted mb-3">
        {plural(lines?.length ?? 0, 'line')} · items marked{' '}
        <span style={{ color: 'var(--danger)' }}>*</span> block a packlist from being marked packed
        while short.
      </p>

      {lines?.length ? (
        <div className="list">
          {lines.map((line) => {
            const item = items?.get(line.itemId);
            return (
              <div key={line.id} className="row row-static">
                <span className="row-body">
                  <span className="row-title truncate">
                    {item?.name ?? 'Unknown item'}
                    {line.mandatory ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
                  </span>
                  <span className="row-sub">
                    {item?.bin || 'no bin'}
                    {line.perRunner ? ' · per runner' : ''}
                  </span>
                  <span className="row-flex mt-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void update(db.templateLines, line.id, { mandatory: !line.mandatory })}
                    >
                      {line.mandatory ? '★ Must-have' : '☆ Optional'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void update(db.templateLines, line.id, { perRunner: !line.perRunner })}
                    >
                      {line.perRunner ? '👤 Per runner' : '# Flat qty'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label="Remove line"
                      onClick={() => setRemoving(line)}
                    >
                      🗑
                    </button>
                  </span>
                </span>
                <span className="row-end">
                  <Stepper
                    label={`quantity of ${item?.name ?? 'item'}`}
                    value={line.qty}
                    min={line.perRunner ? 0 : 1}
                    step={line.perRunner ? 0.01 : 1}
                    onChange={(value) => void update(db.templateLines, line.id, { qty: value })}
                  />
                  {line.perRunner ? <div className="tiny muted mt-2">× runners</div> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card card-pad center muted">Nothing on this template yet.</div>
      )}

      <div className="btn-row mt-4">
        <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
          + Add items
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
          🗑 Delete template
        </button>
      </div>

      {picking ? (
        <ItemPicker
          title="Add to template"
          exclude={(lines ?? []).map((line) => line.itemId)}
          onClose={() => setPicking(false)}
          onPick={(picks) => {
            let sort = nextSort(lines ?? []);
            void createMany(
              db.templateLines,
              picks.map((pick) => {
                sort += 10;
                return {
                  templateId: template.id,
                  itemId: pick.item.id,
                  qty: pick.qty,
                  mandatory: false,
                  perRunner: false,
                  note: '',
                  sort,
                };
              }),
            ).then(() => {
              toast(`${plural(picks.length, 'item')} added`);
              setPicking(false);
            });
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmSheet
          title="Remove this line?"
          body={items?.get(removing.itemId)?.name ?? ''}
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            void softDelete(db.templateLines, removing.id);
            setRemoving(undefined);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmSheet
          title={`Delete ${template.name}?`}
          body="Packlists already built from it are untouched."
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            void (async () => {
              await softDeleteChildren(db.templateLines, 'templateId', template.id);
              await softDelete(db.templates, template.id);
              toast('Template deleted');
              navigate('/templates');
            })();
          }}
        />
      ) : null}

      <div className="mt-4">
        <Pill>{DESTINATION_LABELS[template.appliesTo]}</Pill>
      </div>
    </Screen>
  );
}
