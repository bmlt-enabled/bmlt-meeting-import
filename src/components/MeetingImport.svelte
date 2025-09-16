<script lang="ts">
  import { Button, Card, Helper, Heading, Modal, P } from 'flowbite-svelte';

  import { apiCredentials, authenticatedUser, isLoggedIn } from '../stores/apiCredentials';
  import LoginForm from './LoginForm.svelte';

  let formModal = $state(false);
  let isImportingMeetings = $state(false);
  let meetingImportError = $state(false);
  let loginFailed = $state(false);
  let loginSuccessTimer: ReturnType<typeof setTimeout> | null = null;

  function onaction({ action, data }: { action: string; data: FormData }) {
    // Check the data validity, return false to prevent dialog closing; anything else to proceed
    if (action === 'login' && (data.get('password') as string)?.length < 4) {
      return false;
    }
  }

  function handleLoginSuccess() {
    loginFailed = false;
    // Clear any existing timer
    if (loginSuccessTimer) {
      clearTimeout(loginSuccessTimer);
    }
    // Close modal after a brief delay to show success
    loginSuccessTimer = setTimeout(() => {
      formModal = false;
      loginSuccessTimer = null;
    }, 500);
  }

  function handleLoginFailed() {
    loginFailed = true;
  }

  function openLoginModal() {
    loginFailed = false;
    formModal = true;
  }

  async function importMeetingsFromSpreadsheet(): Promise<void> {
    try {
      meetingImportError = false; // reset them both ....
      isImportingMeetings = true;
      let dataArray: any[] = [];
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(dataArray);
    } catch (err) {
      console.error('Download failed:', err);
      meetingImportError = true;
    } finally {
      isImportingMeetings = false;
    }
  }
</script>

<Card class="mx-auto my-8 w-full max-w-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
  <div class="p-4">
    <div class="mb-4">
      <Heading tag="h1" class="mb-4 text-2xl dark:text-white">Import Meetings</Heading>
      <div class="mb-4 flex items-center justify-center gap-2">
        <Button onclick={openLoginModal}>
          {$isLoggedIn ? 'Change Server/User' : 'Login to Server'}
        </Button>
        {#if $isLoggedIn && $authenticatedUser}
          <div class="flex items-center text-green-600 dark:text-green-400">
            <svg class="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            <span class="text-sm">Logged in as {$authenticatedUser.displayName}</span>
          </div>
        {:else if loginFailed}
          <div class="flex items-center text-red-600 dark:text-red-400">
            <svg class="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
            </svg>
            <span class="text-sm">Login failed</span>
          </div>
        {/if}
      </div>
      <Button onclick={importMeetingsFromSpreadsheet} disabled={isImportingMeetings || !$isLoggedIn} color="primary" class="w-full">
        {#if isImportingMeetings}
          <div class="flex items-center justify-center">
            <div class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            Importing
          </div>
        {:else}
          Import Meetings
        {/if}
      </Button>
      <Helper>Import Meetings</Helper>
    </div>
    {#if meetingImportError}
      <div class="mb-4">
        <P class="text-center text-red-700 dark:text-red-500">Error Importing</P>
      </div>
    {/if}
  </div>
</Card>

<Modal form bind:open={formModal} size="xs" {onaction}>
  <LoginForm {apiCredentials} authenticated={handleLoginSuccess} loginFailed={handleLoginFailed} />
</Modal>
