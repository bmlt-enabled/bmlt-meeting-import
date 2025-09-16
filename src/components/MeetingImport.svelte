<script lang="ts">
  import { Button, Card, Helper, Heading, Modal, P } from 'flowbite-svelte';

  import { apiCredentials } from '../stores/apiCredentials';
  import LoginForm from './LoginForm.svelte';

  let formModal = $state(false);
  let isImportingMeetings = $state(false);
  let meetingImportError = $state(false);

  function onaction({ action, data }: { action: string; data: FormData }) {
    error = '';
    // Check the data validity, return false to prevent dialog closing; anything else to proceed
    if (action === 'login' && (data.get('password') as string)?.length < 4) {
      error = 'Password must have at least 4 characters';
      return false;
    }
  }

  async function importMeetingsFromSpreadsheet(): Promise<void> {
    try {
      meetingImportError = false; // reset them both ....
      isImportingMeetings = true;
      let dataArray = [];
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
      <Button class="mb-4" onclick={() => (formModal = true)}>Login to Server</Button>
      <Button onclick={importMeetingsFromSpreadsheet} disabled={isImportingMeetings} color="primary" class="w-full">
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
  <LoginForm {apiCredentials} />
</Modal>
