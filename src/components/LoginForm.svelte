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
    authenticated: () => void;
  }

  let { apiCredentials, authenticated }: Props = $props();
  let errorMessage: string | undefined = $state();

  let servers = $state<Server[]>([]);
  let selectedServer = $state<Server | undefined>(undefined);
  let isLoadingServers = $state(false);
  let showCustomServerInput = $state(false);
  const defaultRootServerURL = 'https://latest.aws.bmlt.app/main_server/';
  let rootServerURL: string = $state(defaultRootServerURL);
  let serverError: string = $state('');
  let customURL: string = $state('');

  const { form, errors } = createForm({
    initialValues: {
      username: '',
      password: ''
    },
    onSubmit: async (values) => {
      spinner.show();
      await apiCredentials.login(values.username, values.password);
    },
    onSuccess: () => {
      spinner.hide();
      authenticated();
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
      // Set initial server if defaultRootServerURL matches any server
      selectedServer = servers.find((s) => s.rootURL === defaultRootServerURL);
      if (selectedServer) {
        rootServerURL = selectedServer.rootURL;
      }
    } catch (error) {
      console.error('Failed to fetch server list -- ' + error);
      serverError = 'Failed to fetch server list ' + error;
    } finally {
      isLoadingServers = false;
    }
  }

  async function updateRootServerURL(url: string) {
    const s = url.trim();
    // rootServerURL should always end in a '/', unless it's the empty string
    rootServerURL = s === '' || s.endsWith('/') ? s : s + '/';
    // Reset 'operation' when the root server URL changes.  There will also be state for the different operations, but since these are
    // in separate components that state gets reset when the component is rendered again.
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
      updateRootServerURL(server ? server.rootURL : '');
    }
  }

  onMount(initialize);
</script>

<div class="flex flex-col space-y-6">
  <div class="w-full rounded-lg bg-white shadow sm:max-w-md md:mt-0 xl:p-0 dark:border dark:border-gray-700 dark:bg-gray-800">
    <div class="m-8">
      <form use:form>
        <div class="space-y-2">
          <Label for="rootServerURL" class="font-medium text-gray-700 dark:text-gray-300">Root Server URL:</Label>
          <div class="flex gap-2">
            {#if isLoadingServers}
              <div class="flex-1 p-2 text-gray-500 dark:text-gray-400">Loading Servers ....</div>
            {:else}
              <Select
                id="rootServerURL"
                class="flex-1"
                items={[...servers.map((s) => ({ value: s.id, name: s.name })), { value: 'other', name: 'other' }]}
                value={selectedServer?.id || (showCustomServerInput ? 'other' : '')}
                onchange={handleServerSelect}
              />
            {/if}
          </div>
          {#if showCustomServerInput}
            <input
              type="text"
              class="mt-2 block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
              placeholder="url here"
              bind:value={customURL}
            />
            <Button onclick={() => updateRootServerURL(customURL)}>Update URL</Button>
          {/if}
          {#if serverError}
            <Helper class="text-red-500 dark:text-red-400">{serverError}</Helper>
          {/if}
        </div>
        <div class="mb-4">
          <Label for="username" class="mb-2">Username</Label>
          <Input type="text" name="username" id="username" onInput={() => (errorMessage = '')} />
          <Helper class="mt-2" color="red">
            {#if $errors.username}
              {$errors.username}
            {/if}
          </Helper>
        </div>
        <div class="mb-4">
          <Label for="password" class="mb-2">Password</Label>
          <Input type="password" name="password" id="password" onInput={() => (errorMessage = '')} />
          <Helper class="mt-2" color="red">
            {#if $errors.password}
              {$errors.password}
            {/if}
          </Helper>
        </div>
        {#if errorMessage}
          <div class="mb-4">
            <P class="text-red-700 dark:text-red-500">{errorMessage}</P>
          </div>
        {/if}
        <div class="mb-2">
          <Button class="w-full" type="submit" value="login">Login</Button>
        </div>
      </form>
    </div>
  </div>
</div>
