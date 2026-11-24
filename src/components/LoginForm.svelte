<script lang="ts">
  import { validator } from '@felte/validator-yup';
  import { createForm } from 'felte';
  import { Button, Helper, Input, Label, P, Select } from 'flowbite-svelte';
  import * as yup from 'yup';

  import RootServerApi from '../lib/ServerApi';
  import { spinner } from '../stores/spinner';
  import type { ApiCredentialsStore } from '../stores/apiCredentials';
  import { onMount } from 'svelte';

  interface Server {
    id: string;
    name: string;
    rootURL: string;
  }

  interface Props {
    apiCredentials: ApiCredentialsStore;
    authenticated?: () => void;
    loginFailed?: () => void;
  }

  let { apiCredentials, authenticated, loginFailed }: Props = $props();
  let errorMessage: string | undefined = $state();

  let servers = $state<Server[]>([]);
  let selectedServer = $state<Server | undefined>(undefined);
  let isLoadingServers = $state(false);
  let showCustomServerInput = $state(false);
  // No default: the user picks the server they're importing into. A server
  // they chose on an earlier visit is preselected.
  let rootServerURL: string = $state(withTrailingSlash(RootServerApi.currentServerUrl ?? ''));
  let serverError: string = $state('');
  let customURL: string = $state('');

  const { form, errors } = createForm({
    initialValues: {
      username: '',
      password: ''
    },
    onSubmit: async (values) => {
      spinner.show();
      // Applied here rather than on every change, so typing a custom URL
      // doesn't switch servers keystroke by keystroke.
      RootServerApi.updateServerUrl(rootServerURL);
      await apiCredentials.login(values.username, values.password);
    },
    onSuccess: () => {
      spinner.hide();
      errorMessage = undefined;
      authenticated?.();
    },
    onError: async (error) => {
      await RootServerApi.handleErrors(error as Error, {
        handleAuthenticationError: () => {
          errorMessage = 'Invalid Username or Password';
        },
        handleAuthorizationError: () => {
          errorMessage = 'User is deactivated.';
        },
        handleValidationError: (error) => {
          errors.set({
            username: (error?.errors?.username ?? []).join(' '),
            password: (error?.errors?.password ?? []).join(' ')
          });
        }
      });
      spinner.hide();
      loginFailed?.();
    },
    extend: validator({
      schema: yup.object({
        username: yup.string().required(),
        password: yup.string().required()
      })
    })
  });

  async function initialize() {
    isLoadingServers = true;
    try {
      const response = await fetch('https://raw.githubusercontent.com/bmlt-enabled/tomato/refs/heads/master/rootServerList.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      servers = await response.json();
      servers.sort((a, b) => a.name.localeCompare(b.name));
      if (rootServerURL) {
        selectedServer = servers.find((s) => withTrailingSlash(s.rootURL) === rootServerURL);
        if (!selectedServer) {
          // A server typed in by hand last time
          showCustomServerInput = true;
          customURL = rootServerURL;
        }
      }
    } catch (error) {
      // console.error('Failed to fetch server list -- ' + error);
      serverError = 'Failed to fetch server list ' + error;
    } finally {
      isLoadingServers = false;
    }
  }

  // rootServerURL should always end in a '/', unless it's the empty string
  function withTrailingSlash(url: string): string {
    const s = url.trim();
    return s === '' || s.endsWith('/') ? s : s + '/';
  }

  function updateRootServerURL(url: string) {
    rootServerURL = withTrailingSlash(url);
  }

  function handleServerSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    if (select.value === 'other') {
      showCustomServerInput = true;
      rootServerURL = '';
      customURL = '';
      selectedServer = undefined;
    } else {
      showCustomServerInput = false;
      const server = servers.find((s) => s.id === select.value);
      selectedServer = server;
      if (server) {
        updateRootServerURL(server.rootURL);
      }
    }
  }

  onMount(initialize);
</script>

<div class="text-left">
  <form use:form class="space-y-4">
    <div class="space-y-2">
      <Label for="rootServerURL" class="font-medium text-gray-700 dark:text-gray-300">Your BMLT server</Label>
      <div class="flex gap-2">
        {#if isLoadingServers}
          <div class="flex-1 p-2 text-gray-500 dark:text-gray-400">Loading Servers ....</div>
        {:else}
          <Select
            id="rootServerURL"
            class="flex-1"
            placeholder="Choose your server…"
            items={[...servers.map((s) => ({ value: s.id, name: s.name })), { value: 'other', name: 'Other (enter URL)' }]}
            value={selectedServer?.id || (showCustomServerInput ? 'other' : '')}
            onchange={handleServerSelect}
          />
        {/if}
      </div>
      {#if showCustomServerInput}
        <Input
          id="customServerURL"
          type="url"
          class="mt-2"
          placeholder="https://bmlt.example.org/main_server/"
          aria-label="Server URL"
          bind:value={customURL}
          oninput={() => updateRootServerURL(customURL)}
        />
      {/if}
      <Helper class="text-gray-500 dark:text-gray-400">The BMLT root server you're importing meetings into. Log in with your admin account on that server.</Helper>
      {#if serverError}
        <Helper class="text-red-500 dark:text-red-400">{serverError}</Helper>
      {/if}
    </div>
    <div>
      <Label for="username" class="mb-2">Username</Label>
      <Input type="text" name="username" id="username" onInput={() => (errorMessage = '')} />
      <Helper class="mt-2" color="red">
        {#if $errors.username}
          {$errors.username}
        {/if}
      </Helper>
    </div>
    <div>
      <Label for="password" class="mb-2">Password</Label>
      <Input type="password" name="password" id="password" onInput={() => (errorMessage = '')} />
      <Helper class="mt-2" color="red">
        {#if $errors.password}
          {$errors.password}
        {/if}
      </Helper>
    </div>
    {#if errorMessage}
      <div>
        <P class="text-red-700 dark:text-red-500">{errorMessage}</P>
      </div>
    {/if}
    <div>
      <Button class="w-full" type="submit" value="login" disabled={!rootServerURL}>Log in</Button>
    </div>
  </form>
</div>
