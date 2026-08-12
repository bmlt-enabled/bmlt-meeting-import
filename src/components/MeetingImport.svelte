<script lang="ts">
  import { Button, Card, Checkbox, Helper, Heading, Input, Label, Modal, P, Fileupload, Alert, Toast } from 'flowbite-svelte';

  import { apiCredentials, authenticatedUser, isLoggedIn, currentServerUrl } from '../stores/apiCredentials';
  import LoginForm from './LoginForm.svelte';
  import { MeetingImportService, type BmltSourcePreview, type ImportProgress, type ImportResult } from '../lib/MeetingImportService';
  import { onDestroy } from 'svelte';

  let formModal = $state(false);
  let isImportingMeetings = $state(false);
  let meetingImportError = $state(false);
  let loginFailed = $state(false);
  let loginSuccessTimer: ReturnType<typeof setTimeout> | null = null;

  // Import related state
  let selectedFile: File | null = $state(null);
  let importProgress: ImportProgress | null = $state(null);
  let importResult: ImportResult | null = $state(null);
  let showImportResults = $state(false);
  let fileValidation: { valid: boolean; errors: string[]; warnings: string[]; preview: any } | null = $state(null);
  let isValidatingFile = $state(false);
  let fileValidationMessage = $state('Validating file...');
  let importAbortController: AbortController | null = $state(null);

  // Importing straight from another BMLT server
  let importSource: 'file' | 'server' = $state('file');
  let sourceUrl = $state('');
  let sourceServiceBodyIds = $state('');
  let sourceRecursive = $state(true);
  let sourceIncludeUnpublished = $state(false);
  let sourceTimeZone = $state('');
  let sourcePreview: BmltSourcePreview | null = $state(null);
  let isLoadingPreview = $state(false);
  let previewMessage = $state('');
  let previewError = $state('');

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

  async function handleFileSelect(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) {
      selectedFile = null;
      fileValidation = null;
      return;
    }

    // Validate file size
    if (file.size > MeetingImportService.getMaxFileSize()) {
      alert(`File too large. Maximum size is ${MeetingImportService.getMaxFileSize() / 1024 / 1024}MB`);
      target.value = '';
      return;
    }

    // Validate file type
    const supportedTypes = MeetingImportService.getSupportedFileTypes();
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!supportedTypes.includes(fileExtension)) {
      alert(`Unsupported file type. Supported types: ${supportedTypes.join(', ')}`);
      target.value = '';
      return;
    }

    selectedFile = file;
    await validateSelectedFile();
  }

  async function validateSelectedFile(): Promise<void> {
    if (!selectedFile) return;

    isValidatingFile = true;
    fileValidation = null;
    fileValidationMessage = 'Validating file...';

    try {
      fileValidation = await MeetingImportService.validateFile(selectedFile, (message) => {
        fileValidationMessage = message;
      });
    } catch (error) {
      console.error('File validation failed:', error);
      fileValidation = {
        valid: false,
        errors: [error instanceof Error ? error.message : 'File validation failed'],
        warnings: [],
        preview: { totalRows: 0, validRows: 0, sampleRows: [] }
      };
    } finally {
      isValidatingFile = false;
    }
  }

  async function importMeetingsFromSpreadsheet(): Promise<void> {
    if (!selectedFile || !fileValidation?.valid) {
      meetingImportError = true;
      return;
    }

    try {
      meetingImportError = false;
      isImportingMeetings = true;
      importResult = null;
      importProgress = null;

      // Create AbortController for cancellation
      importAbortController = new AbortController();

      const result = await MeetingImportService.importFromFile(
        selectedFile,
        {
          defaultDuration: '01:00',
          defaultLatitude: 0,
          defaultLongitude: 0,
          defaultPublished: true
        },
        (progress) => {
          importProgress = progress;
        },
        importAbortController.signal
      );

      importResult = result;
      showImportResults = true;

      if (!result.success) {
        meetingImportError = true;
      }
    } catch (err) {
      console.error('Import failed:', err);

      // Handle cancellation differently from other errors
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Import was cancelled - show appropriate message
        importResult = {
          success: false,
          totalProcessed: 0,
          successfulImports: 0,
          failedImports: 0,
          skippedImports: 0,
          servicesBodiesCreated: 0,
          errors: ['Import cancelled by user'],
          warnings: [],
          createdMeetings: [],
          duration: 0
        };
        showImportResults = true;
        meetingImportError = false;
      } else {
        meetingImportError = true;
        importResult = {
          success: false,
          totalProcessed: 0,
          successfulImports: 0,
          failedImports: 0,
          skippedImports: 0,
          servicesBodiesCreated: 0,
          errors: [err instanceof Error ? err.message : 'Unknown error occurred'],
          warnings: [],
          createdMeetings: [],
          duration: 0
        };
      }
    } finally {
      isImportingMeetings = false;
      importProgress = null;
      importAbortController = null;
    }
  }

  function failedImportResult(message: string): ImportResult {
    return {
      success: false,
      totalProcessed: 0,
      successfulImports: 0,
      failedImports: 0,
      skippedImports: 0,
      servicesBodiesCreated: 0,
      errors: [message],
      warnings: [],
      createdMeetings: [],
      duration: 0
    };
  }

  async function loadSourcePreview(): Promise<void> {
    if (!sourceUrl.trim()) {
      return;
    }

    isLoadingPreview = true;
    previewError = '';
    sourcePreview = null;
    previewMessage = 'Reading source server...';

    try {
      sourcePreview = await MeetingImportService.previewBmltSource(
        sourceUrl,
        {
          serviceBodyIds: sourceServiceBodyIds
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
          recursive: sourceRecursive,
          includeUnpublished: sourceIncludeUnpublished
        },
        (message) => {
          previewMessage = message;
        }
      );
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'Could not read the source server';
    } finally {
      isLoadingPreview = false;
    }
  }

  async function importMeetingsFromServer(): Promise<void> {
    if (!sourcePreview) {
      meetingImportError = true;
      return;
    }

    try {
      meetingImportError = false;
      isImportingMeetings = true;
      importResult = null;
      importProgress = null;
      importAbortController = new AbortController();

      const result = await MeetingImportService.importFromBmltServer(
        sourcePreview,
        {
          defaultTimeZone: sourceTimeZone.trim(),
          defaultLatitude: 0,
          defaultLongitude: 0
        },
        (progress) => {
          importProgress = progress;
        },
        importAbortController.signal
      );

      importResult = result;
      showImportResults = true;

      if (!result.success) {
        meetingImportError = true;
      }
    } catch (err) {
      console.error('Import failed:', err);

      if (err instanceof DOMException && err.name === 'AbortError') {
        importResult = failedImportResult('Import cancelled by user');
        showImportResults = true;
        meetingImportError = false;
      } else {
        meetingImportError = true;
        importResult = failedImportResult(err instanceof Error ? err.message : 'Unknown error occurred');
      }
    } finally {
      isImportingMeetings = false;
      importProgress = null;
      importAbortController = null;
    }
  }

  function selectImportSource(source: 'file' | 'server'): void {
    importSource = source;
    importResult = null;
    showImportResults = false;
    meetingImportError = false;
  }

  function cancelImport(): void {
    if (importAbortController && !importAbortController.signal.aborted) {
      importAbortController.abort();
    }
  }

  function resetImport(): void {
    selectedFile = null;
    fileValidation = null;
    importResult = null;
    importProgress = null;
    showImportResults = false;
    meetingImportError = false;
    sourcePreview = null;
    previewError = '';

    // Reset file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  // Cleanup function to prevent memory leaks
  function cleanup(): void {
    // Cancel any ongoing import
    if (importAbortController && !importAbortController.signal.aborted) {
      importAbortController.abort();
    }

    // Clear any pending timers
    if (loginSuccessTimer) {
      clearTimeout(loginSuccessTimer);
      loginSuccessTimer = null;
    }

    // Clear large objects
    selectedFile = null;
    fileValidation = null;
    importResult = null;
    importProgress = null;
    importAbortController = null;
    sourcePreview = null;
  }

  // Cleanup on component destroy
  onDestroy(cleanup);
</script>

<Card class="mx-auto my-8 w-full max-w-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
  <div class="p-4">
    <div class="mb-4">
      <Heading tag="h1" class="mb-4 text-2xl dark:text-white">Import Meetings</Heading>

      <!-- Server URL Display -->
      <div class="mb-4 text-center">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          <span class="font-medium">Server:</span>
          <span class="ml-2 font-mono text-blue-600 dark:text-blue-400">
            {$currentServerUrl || 'Not configured'}
          </span>
        </div>
      </div>

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
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd"
              />
            </svg>
            <span class="text-sm">Login failed</span>
          </div>
        {/if}
      </div>

      <!-- Import Source -->
      {#if $isLoggedIn}
        <div class="mb-4 grid grid-cols-2 gap-2">
          <Button size="sm" color={importSource === 'file' ? 'primary' : 'alternative'} onclick={() => selectImportSource('file')} disabled={isImportingMeetings}>Spreadsheet</Button>
          <Button size="sm" color={importSource === 'server' ? 'primary' : 'alternative'} onclick={() => selectImportSource('server')} disabled={isImportingMeetings}>BMLT Server</Button>
        </div>
      {/if}

      <!-- File Upload Section -->
      {#if $isLoggedIn && importSource === 'file'}
        <div class="mb-6 space-y-4">
          <div class="mb-4">
            <label class="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-300" for="file-upload"> Select NAWS Export File </label>
            <Fileupload id="file-upload" onchange={handleFileSelect} accept={MeetingImportService.getSupportedFileTypes().join(',')} class="w-full" />
            <Helper class="mt-2">
              Supported formats: Excel (.xlsx, .xls), CSV (.csv), OpenDocument (.ods)
              <br />Maximum file size: {MeetingImportService.getMaxFileSize() / 1024 / 1024}MB
            </Helper>
          </div>

          {#if isValidatingFile}
            <div class="flex items-center justify-center space-x-2 py-4">
              <div class="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
              <span class="text-sm text-gray-600 dark:text-gray-400">{fileValidationMessage}</span>
            </div>
          {/if}

          {#if fileValidation}
            {#if fileValidation.valid}
              <Alert color="green">
                <span class="font-medium">File is valid!</span>
                <br />Found {fileValidation.preview.validRows} valid meetings out of {fileValidation.preview.totalRows} total rows.
              </Alert>

              {#if fileValidation.warnings.length > 0}
                <Alert color="yellow">
                  <span class="font-medium">Warnings:</span>
                  <ul class="mt-2 list-inside list-disc">
                    {#each fileValidation.warnings.slice(0, 5) as warning}
                      <li class="text-sm">{warning}</li>
                    {/each}
                    {#if fileValidation.warnings.length > 5}
                      <li class="text-sm italic">...and {fileValidation.warnings.length - 5} more warnings</li>
                    {/if}
                  </ul>
                </Alert>
              {/if}
            {:else}
              <Alert color="red">
                <span class="font-medium">File validation failed:</span>
                <ul class="mt-2 list-inside list-disc">
                  {#each fileValidation.errors as error}
                    <li class="text-sm">{error}</li>
                  {/each}
                </ul>
              </Alert>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- BMLT Server Source Section -->
      {#if $isLoggedIn && importSource === 'server'}
        <div class="mb-6 space-y-4 text-left">
          <div>
            <Label for="source-url" class="mb-2">Source root server URL</Label>
            <Input id="source-url" bind:value={sourceUrl} placeholder="https://bmlt.example.org/main_server/" disabled={isImportingMeetings} />
            <Helper class="mt-2">Meetings are read from this server's public interface and copied to {$currentServerUrl}.</Helper>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label for="source-services" class="mb-2">Service body ids</Label>
              <Input id="source-services" bind:value={sourceServiceBodyIds} placeholder="All" disabled={isImportingMeetings} />
            </div>
            <div>
              <Label for="source-timezone" class="mb-2">Fallback time zone</Label>
              <Input id="source-timezone" bind:value={sourceTimeZone} placeholder="America/Denver" disabled={isImportingMeetings} />
            </div>
          </div>

          <div class="space-y-2">
            <Checkbox bind:checked={sourceRecursive} disabled={isImportingMeetings}>Include child service bodies</Checkbox>
            <Checkbox bind:checked={sourceIncludeUnpublished} disabled={isImportingMeetings}>Include unpublished meetings</Checkbox>
          </div>

          <Button size="sm" color="alternative" class="w-full" onclick={loadSourcePreview} disabled={!sourceUrl.trim() || isLoadingPreview || isImportingMeetings}>
            {sourcePreview ? 'Refresh preview' : 'Read source server'}
          </Button>

          {#if isLoadingPreview}
            <div class="flex items-center justify-center space-x-2 py-2">
              <div class="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
              <span class="text-sm text-gray-600 dark:text-gray-400">{previewMessage}</span>
            </div>
          {/if}

          {#if previewError}
            <Alert color="red">
              <span class="font-medium">Could not read the source server:</span>
              <div class="mt-1 text-sm">{previewError}</div>
            </Alert>
          {/if}

          {#if sourcePreview}
            <Alert color="green">
              <span class="font-medium">Found {sourcePreview.meetingCount} meetings</span>
              <div class="mt-1 text-sm">across {sourcePreview.serviceBodyMatches.filter((match) => !match.ancestorOnly).length} service bodies.</div>
            </Alert>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 dark:border-gray-700 dark:text-gray-200">Service bodies</div>
              <ul class="max-h-48 divide-y divide-gray-100 overflow-y-auto text-sm dark:divide-gray-700">
                {#each sourcePreview.serviceBodyMatches as match}
                  <li class="flex items-start justify-between gap-2 px-3 py-2">
                    <span class="text-gray-700 dark:text-gray-300">
                      {match.source.name}
                      {#if match.ancestorOnly}
                        <span class="text-xs text-gray-400">(parent only)</span>
                      {:else}
                        <span class="text-xs text-gray-400">({match.meetingCount})</span>
                      {/if}
                    </span>
                    {#if match.destination}
                      <span class="shrink-0 text-green-600 dark:text-green-400">matched by {match.matchedBy}</span>
                    {:else}
                      <span class="shrink-0 text-blue-600 dark:text-blue-400">will be created</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>

            {#if sourcePreview.unmatchedFormats.length > 0}
              <Alert color="yellow">
                <span class="font-medium">Formats with no match on this server:</span>
                <div class="mt-1 text-sm">
                  {sourcePreview.unmatchedFormats.map((match) => match.source.key_string).join(', ')} — these will be dropped.
                </div>
              </Alert>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Import Progress -->
      {#if importProgress}
        <div class="mb-6 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{importProgress.message}</span>
            <span class="text-sm text-gray-500 dark:text-gray-400">{importProgress.percentage}%</span>
          </div>
          <div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div class="h-2 rounded-full bg-blue-600 transition-all duration-300 ease-in-out" style="width: {importProgress.percentage}%"></div>
          </div>
          <div class="text-center text-xs text-gray-500 dark:text-gray-400">
            Step {importProgress.currentStep} of {importProgress.totalSteps}
          </div>
        </div>
      {/if}

      <!-- Action Buttons -->
      <div class="flex flex-col space-y-2">
        {#if isImportingMeetings}
          <Button onclick={cancelImport} color="red" class="w-full">
            <div class="flex items-center justify-center">
              <div class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              Cancel Import
            </div>
          </Button>
        {:else if showImportResults}
          <Button onclick={resetImport} color="alternative" class="w-full">Start Another Import</Button>
        {:else if !$isLoggedIn}
          <Helper class="text-center text-gray-500 dark:text-gray-400">Please log in to import meetings</Helper>
        {:else if importSource === 'server'}
          {#if sourcePreview}
            <Button onclick={importMeetingsFromServer} color="primary" class="w-full">
              Import {sourcePreview.meetingCount} Meetings
            </Button>
          {:else}
            <Helper class="text-center text-gray-500 dark:text-gray-400">Enter a source root server URL and read it to begin</Helper>
          {/if}
        {:else if selectedFile && fileValidation?.valid}
          <Button onclick={importMeetingsFromSpreadsheet} color="primary" class="w-full">
            Import {fileValidation.preview.validRows} Meetings
          </Button>
        {:else}
          <Helper class="text-center text-gray-500 dark:text-gray-400"
            >Select a valid NAWS export file to begin import (<a
              href="/BMLT_Export_Example.xlsx"
              download
              class="text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 underline">download example</a
            >)</Helper
          >
        {/if}
      </div>

      <!-- Import Results -->
      {#if showImportResults && importResult}
        <div class="mt-6 space-y-4">
          {#if importResult.success}
            <Alert color="green">
              <span class="font-medium">Import Completed Successfully!</span>
              <div class="mt-2 space-y-1 text-sm">
                <div>✅ {importResult.successfulImports} meetings created</div>
                {#if importResult.servicesBodiesCreated > 0}
                  <div>🏢 {importResult.servicesBodiesCreated} service bodies created</div>
                {/if}
                {#if importResult.skippedImports > 0}
                  <div>⏭️ {importResult.skippedImports} meetings skipped (already exist)</div>
                {/if}
                {#if importResult.failedImports > 0}
                  <div>❌ {importResult.failedImports} meetings failed</div>
                {/if}
                <div>⏱️ Completed in {Math.round(importResult.duration / 1000)} seconds</div>
              </div>
            </Alert>
          {:else}
            <Alert color="red">
              <span class="font-medium">Import Failed</span>
              <div class="mt-2 space-y-1 text-sm">
                {#if importResult.successfulImports > 0}
                  <div>✅ {importResult.successfulImports} meetings created</div>
                {/if}
                {#if importResult.servicesBodiesCreated > 0}
                  <div>🏢 {importResult.servicesBodiesCreated} service bodies created</div>
                {/if}
                {#if importResult.skippedImports > 0}
                  <div>⏭️ {importResult.skippedImports} meetings skipped (already exist)</div>
                {/if}
                <div>❌ {importResult.failedImports} meetings failed</div>
              </div>
            </Alert>
          {/if}

          {#if importResult.warnings.length > 0}
            <Alert color="yellow">
              <span class="font-medium">Warnings ({importResult.warnings.length}):</span>
              <div class="mt-2 max-h-32 overflow-y-auto">
                <ul class="list-inside list-disc space-y-1 text-sm">
                  {#each importResult.warnings.slice(0, 10) as warning}
                    <li>{warning}</li>
                  {/each}
                  {#if importResult.warnings.length > 10}
                    <li class="italic">...and {importResult.warnings.length - 10} more warnings</li>
                  {/if}
                </ul>
              </div>
            </Alert>
          {/if}

          {#if importResult.errors.length > 0 && importResult.errors[0] === 'Import cancelled by user'}
            <Alert color="yellow">
              <span class="font-medium">Import Cancelled</span>
              <div class="mt-2 text-sm">The import was cancelled by the user. No meetings were imported.</div>
            </Alert>
          {:else if importResult.errors.length > 0}
            <Alert color="red">
              <span class="font-medium">Errors ({importResult.errors.length}):</span>
              <div class="mt-2 max-h-32 overflow-y-auto">
                <ul class="list-inside list-disc space-y-1 text-sm">
                  {#each importResult.errors.slice(0, 10) as error}
                    <li>{error}</li>
                  {/each}
                  {#if importResult.errors.length > 10}
                    <li class="italic">...and {importResult.errors.length - 10} more errors</li>
                  {/if}
                </ul>
              </div>
            </Alert>
          {/if}
        </div>
      {/if}

      {#if meetingImportError && !showImportResults}
        <div class="mb-4">
          <P class="text-center text-red-700 dark:text-red-500">Import Error Occurred</P>
        </div>
      {/if}
    </div>
  </div>
</Card>

<Modal form bind:open={formModal} size="xs" {onaction}>
  <LoginForm {apiCredentials} authenticated={handleLoginSuccess} loginFailed={handleLoginFailed} />
</Modal>

<Toast color="yellow" position="bottom-right">
  {#snippet icon()}
    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clip-rule="evenodd"
      />
    </svg>
  {/snippet}
  This tool modifies meeting data directly on the connected server. Always test on a staging server before running against production.
</Toast>
