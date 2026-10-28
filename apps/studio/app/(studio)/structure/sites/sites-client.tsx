'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Select,
  TextInput,
} from '@phoenix/ui';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../_client/api';
import { failureMessage } from '../../../_lib/api-answer';
import { indentedSiteName } from '../../../_lib/people';
import {
  hostnameOf,
  indentOf,
  isSiteName,
  isSlug,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  pathPrefixOf,
  ROOT_OPTION,
} from '../../../_lib/structure';
import { fill, type Messages } from '../../../_i18n/messages';
import { ConfirmDialog } from '../../_components/confirm-dialog';

// The site tree's changes: create a site, rename it or link it to an organization unit, and add
// or remove its domains. Moving is the shared MoveDialog. Each form points at the field the API
// would refuse before sending; the API checks everything again.

export interface TreeOption {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

const NO_ORGANIZATION = 'none';

const treeOptions = (items: readonly TreeOption[]) =>
  items.map((item) => ({
    value: item.id,
    label: indentedSiteName({ ...item, depth: indentOf(item.depth) }),
  }));

function OrganizationField(props: {
  readonly t: Messages;
  readonly organizations: readonly TreeOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const { t } = props;
  return (
    <Field label={t['siteForm.organization']}>
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) props.onChange(value);
        }}
        options={[
          { value: NO_ORGANIZATION, label: t['siteForm.noOrganization'] },
          ...treeOptions(props.organizations),
        ]}
      />
    </Field>
  );
}

const CREATE_FORM = 'create-site';

export function CreateSiteDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly sites: readonly TreeOption[];
  /** Null when the member cannot read the organization chart: the site is created unlinked. */
  readonly organizations: readonly TreeOption[] | null;
  /** The parent the dialog starts with (a site page's "new subsite"); a root otherwise. */
  readonly parentId?: string;
  readonly trigger?: 'primary' | 'outline';
}) {
  const { t, csrfToken, sites, organizations } = props;
  const router = useRouter();
  const startParent = props.parentId ?? ROOT_OPTION;
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState(startParent);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [organization, setOrganization] = useState(NO_ORGANIZATION);
  const [invalid, setInvalid] = useState<'name' | 'slug' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isSiteName(name)) return setInvalid('name');
    if (!isSlug(slug)) return setInvalid('slug');
    setBusy(true);
    const answer = await callApi<{ id: string }>('POST', 'tenancy/sites', csrfToken, {
      parentSiteId: parent === ROOT_OPTION ? null : parent,
      organizationId: organization === NO_ORGANIZATION ? null : organization,
      slug,
      name: name.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      // The new site's next step is its domains.
      router.push(`/structure/sites/${answer.body.id}`);
      return;
    }
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setParent(startParent);
          setName('');
          setSlug('');
          setOrganization(NO_ORGANIZATION);
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          props.trigger === 'outline' ? (
            <Button variant="outline" size="sm">
              <Plus aria-hidden />
              {t['site.addChild']}
            </Button>
          ) : (
            <Button>
              <Plus aria-hidden />
              {t['sites.add']}
            </Button>
          )
        }
      />
      <DialogContent
        title={t['siteCreate.title']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['siteCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['siteForm.parent']}>
            <Select
              value={parent}
              onValueChange={(value) => {
                if (value !== null) setParent(value);
              }}
              options={[{ value: ROOT_OPTION, label: t['siteForm.root'] }, ...treeOptions(sites)]}
            />
          </Field>
          <Field label={t['siteForm.name']} error={t['error.name']} invalid={invalid === 'name'}>
            <TextInput
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setInvalid(null);
              }}
              required
            />
          </Field>
          <Field
            label={t['siteForm.slug']}
            description={t['siteForm.slugHint']}
            error={t['error.slug']}
            invalid={invalid === 'slug'}
          >
            <TextInput
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_SLUG_LENGTH}
              value={slug}
              onChange={(event) => {
                setSlug(event.currentTarget.value);
                setInvalid(null);
              }}
              required
            />
          </Field>
          {organizations === null ? null : (
            <OrganizationField
              t={t}
              organizations={organizations}
              value={organization}
              onChange={setOrganization}
            />
          )}
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EDIT_FORM = 'edit-site';

export function EditSiteDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly site: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly organizationId: string | null;
    readonly version: number;
  };
  /** Null when the member cannot read the organization chart: the link is kept as it is. */
  readonly organizations: readonly TreeOption[] | null;
}) {
  const { t, csrfToken, site, organizations } = props;
  const router = useRouter();
  const startOrganization = site.organizationId ?? NO_ORGANIZATION;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(site.name);
  const [organization, setOrganization] = useState(startOrganization);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isSiteName(name)) return setInvalid(true);
    setBusy(true);
    const answer = await callApi('PATCH', `tenancy/sites/${site.id}`, csrfToken, {
      version: site.version,
      name: name.trim(),
      organizationId: organization === NO_ORGANIZATION ? null : organization,
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setProblem(t[failureMessage(answer)]);
      // A stale version: read the current one, so the next try carries it.
      if (answer.code === 'conflict.stale') router.refresh();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(site.name);
          setOrganization(startOrganization);
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Pencil aria-hidden />
            {t['site.edit']}
          </Button>
        }
      />
      <DialogContent
        title={t['siteEdit.title']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={EDIT_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['common.save']}
            </Button>
          </>
        }
      >
        <form id={EDIT_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['siteForm.name']} error={t['error.name']} invalid={invalid}>
            <TextInput
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setInvalid(false);
              }}
              required
            />
          </Field>
          <Field label={t['siteForm.slug']} description={t['siteEdit.slugFixed']}>
            <TextInput dir="ltr" value={site.slug} readOnly disabled />
          </Field>
          {organizations === null ? null : (
            <OrganizationField
              t={t}
              organizations={organizations}
              value={organization}
              onChange={setOrganization}
            />
          )}
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DOMAIN_FORM = 'add-domain';

export function AddDomainDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly siteId: string;
}) {
  const { t, csrfToken, siteId } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [path, setPath] = useState('');
  const [invalid, setInvalid] = useState<'hostname' | 'pathPrefix' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const host = hostnameOf(hostname);
    if (host === null) return setInvalid('hostname');
    const prefix = pathPrefixOf(path);
    if (prefix === null) return setInvalid('pathPrefix');
    setBusy(true);
    const answer = await callApi('POST', `tenancy/sites/${siteId}/domains`, csrfToken, {
      hostname: host,
      pathPrefix: prefix,
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setProblem(t[failureMessage(answer)]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setHostname('');
          setPath('');
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            {t['domains.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['domainAdd.title']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={DOMAIN_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['domainAdd.submit']}
            </Button>
          </>
        }
      >
        <form id={DOMAIN_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field
            label={t['domainAdd.hostname']}
            description={t['domainAdd.hostnameHint']}
            error={t['error.hostname']}
            invalid={invalid === 'hostname'}
          >
            <TextInput
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={253}
              value={hostname}
              onChange={(event) => {
                setHostname(event.currentTarget.value);
                setInvalid(null);
              }}
              required
            />
          </Field>
          <Field
            label={t['domainAdd.path']}
            description={t['domainAdd.pathHint']}
            error={t['error.pathPrefix']}
            invalid={invalid === 'pathPrefix'}
          >
            <TextInput
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              value={path}
              onChange={(event) => {
                setPath(event.currentTarget.value);
                setInvalid(null);
              }}
            />
          </Field>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDomainButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly domainId: string;
  /** The domain as people read it, for the question. */
  readonly address: string;
}) {
  const { t, csrfToken, domainId } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" className="text-critical!">
              {t['domains.remove']}
            </Button>
          }
        />
      }
      title={t['domains.remove.title']}
      description={fill(t['domains.remove.description'], {
        // Isolated, so a left-to-right address reads whole inside a right-to-left sentence.
        name: `\u2066${props.address}\u2069`,
      })}
      confirmLabel={t['domains.remove.confirm']}
      onConfirm={() => callApi('DELETE', `tenancy/site-domains/${domainId}`, csrfToken)}
      onDone={() => router.refresh()}
    />
  );
}
