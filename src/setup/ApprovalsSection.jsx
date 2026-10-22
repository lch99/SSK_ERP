import * as P from '../../shared/payout.js'
import { C, inp, sel, btn } from '../styles.js'
import Section from './Section.jsx'
import { useDraft } from './useDraft.js'
import { Field, Group, Choice, rmHint } from './ui.jsx'
import { NumberingFields } from './NumberingSection.jsx'
import { ApprovalFlow, PayDays } from './visuals.jsx'

// The choice marked Recommended on each question, all at once.
const RECOMMENDED = { dealApprover: 'manager', bossAbove: '', refundApprover: 'boss', payWhen: 'full', payRun: 'weekly', payDay: 5 }

// ── Approvals and numbering ──────────────────────────────────────────────────

export default function ApprovalsSection({ setup, save, step, done }) {
  const [d, setD, aDirty, aReset] = useDraft(setup.approvals)
  const [n, setN, nDirty, nReset] = useDraft({ ...setup.numbering, branches: setup.numbering.branches || {} })
  const set = (k, v) => setD({ ...d, [k]: v })
  const numberErrors = P.validateNumbering(n, setup.dealTypes, setup.branches)
  const picked = ['dealApprover', 'refundApprover', 'payWhen', 'payRun'].filter(k => d[k]).length

  return (
    <Section id="approvals" step={step} title="Approvals and numbering" done={done} dirty={aDirty || nDirty} onReset={() => { aReset(); nReset() }}
      hint="Who signs off before money goes out, when agents get paid, and how cases and vouchers are numbered."
      errors={[...P.validateApprovals(d), ...numberErrors]} onSave={() => save([['approvals', d], ['numbering', n]])}>

      {picked < 4 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, background: C.okBg, marginBottom: 18, fontSize: 13.5 }}>
          <span style={{ flex: '1 1 260px' }}>Not sure? The <b>Recommended</b> choices suit most agencies: the branch manager approves, you approve refunds, agents are paid every Friday once the client has paid in full.</span>
          <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => setD({ ...RECOMMENDED })}>Use the recommended choices</button>
        </div>
      )}

      <Group first title="Who approves a deal's payout?" note="Before any voucher is paid, the deal's split must be approved.">
        <Choice name="dealApprover" value={d.dealApprover} onChange={v => set('dealApprover', v)} recommended="manager" min={190}
          options={[
            { value: 'manager', label: 'Branch manager', desc: 'Fastest. The manager knows the deal.' },
            { value: 'boss', label: 'Boss / director', desc: 'Every payout comes to you.' },
            { value: 'both', label: 'Manager, then boss', desc: 'Two checks on every deal.' },
          ]} />
        {d.dealApprover === 'manager' && (
          <Field title="…but the boss must also approve when the commission is above" style={{ marginTop: 12, maxWidth: 360 }}
            help={rmHint(d.bossAbove) ? `Deals over ${rmHint(d.bossAbove)} also need your approval.` : 'Leave blank if the manager can approve any amount.'}>
            <span style={{ whiteSpace: 'nowrap' }}>RM <input style={{ ...inp, width: 140 }} type="number" min="0" step="1000" placeholder="e.g. 20000"
              value={d.bossAbove ?? ''} onChange={e => set('bossAbove', e.target.value)} /></span>
          </Field>
        )}
      </Group>

      <Group title="Who approves refunds?" note="Refunds take money back out of the company, so most bosses keep this for themselves.">
        <Choice name="refundApprover" value={d.refundApprover} onChange={v => set('refundApprover', v)} recommended="boss" min={190}
          options={[{ value: 'boss', label: 'Boss / director' }, { value: 'manager', label: 'Branch manager' }]} />
      </Group>

      <Group title="When do agents get paid?">
        <Choice name="payWhen" value={d.payWhen} onChange={v => set('payWhen', v)} recommended="full" min={240} options={P.PAY_WHEN} />
      </Group>

      <Group title="How often are payments made?" note="Approved payouts wait for the next payment day, so the accounts team pays in one batch.">
        <Choice name="payRun" value={d.payRun} onChange={v => setD({ ...d, payRun: v, payDay: v === 'weekly' ? 5 : v === 'monthly' ? 25 : '' })}
          recommended="weekly" min={190} options={P.PAY_RUNS} />
        {d.payRun === 'weekly' && (
          <Field title="Payment day" style={{ marginTop: 12, maxWidth: 220 }}>
            <select style={{ ...sel, width: '100%' }} value={d.payDay} onChange={e => set('payDay', Number(e.target.value))}>
              {P.WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
            </select>
          </Field>
        )}
        {d.payRun === 'monthly' && (
          <Field title="Day of the month (1–28)" style={{ marginTop: 12, maxWidth: 220 }}>
            <input style={{ ...inp, width: 90 }} type="number" min="1" max="28" value={d.payDay} onChange={e => set('payDay', e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
        )}
        <PayDays a={d} />
      </Group>

      <ApprovalFlow a={d} />

      <Group title="Case and voucher numbers" note="Every case and payment voucher gets a number: a prefix plus a running number.">
        <NumberingFields setup={setup} d={n} setD={setN} errors={numberErrors} />
      </Group>
    </Section>
  )
}
