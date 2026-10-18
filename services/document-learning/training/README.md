# Optional Offline LoRA Trainer

This directory owns actual weight adaptation, not extraction-profile prompting.
It is an optional operator job, not an upload endpoint or automatic learner.
The parent Node pipeline owns privacy approval, tenant isolation, normalized
export, train/evaluation source separation, held-out evaluation, and candidate
registration. This trainer cannot approve or activate a release.

## Local Runtime

Provision a dedicated, carrier-owned supported Python environment before
introducing documents. The optional runtime needs PyTorch, Transformers, PEFT,
Accelerate and safetensors, plus their tokenizer/Hub dependencies. Select
maintained compatible versions for the chosen model/CUDA runtime, resolve a
complete hash-pinned dependency lock, review advisories and run real training
smoke tests in the carrier build process. No prevalidated ML runtime or dependency
lock is shipped here; do not interpret contract tests as dependency certification.
No dependencies or weights are installed/downloaded by the trainer.
The validation tests need only Python's standard library (also run on 3.9).

The implementation uses the Transformers local chat-template and causal-model
APIs plus PEFT's causal-LM LoRA wrapper with `all-linear` targets:
[Transformers security guidance](https://github.com/huggingface/transformers/security),
[PEFT LoRA documentation](https://huggingface.co/docs/peft/en/package_reference/lora).
No Trainer integrations, datasets library, WandB, shell execution, external
model-code execution, pickle weights, or quantization plugins are used.

Supply a complete, approved local Hugging Face causal-LM directory containing
`config.json`, safetensors base weights (and index if sharded), tokenizer assets,
and a reviewed chat template. Remote model identifiers are not accepted unless
they actually identify an existing local directory. Snapshot symlinks escaping
that directory are rejected; provision a materialized local snapshot.
Review templates/configuration and the model license before use. Protect base
artifacts against concurrent writes; hashes are checked before and after training.

## Input Contract

The parent exporter must supply UTF-8 JSONL with only normalized examples:

```json
{"messages":[{"role":"system","content":"Extract synthetic facts."},{"role":"user","content":"Synthetic applicant: Example LLC"},{"role":"assistant","content":"{\"name\":\"Example LLC\"}"}]}
```

Each example is an optional initial system message followed by alternating
user/assistant turns ending in an assistant. Extra keys, split wrappers,
empty content, duplicate JSON keys, blank lines and malformed inputs fail closed.
Only the final assistant response (including its template terminator) is
supervised; previous messages are masked context. The approved template must
produce a generation prompt that is an exact token prefix of the full exchange.
Oversized sequences are rejected, never silently truncated.

`INPUT.jsonl.manifest.json` is mandatory:

```json
{"schemaVersion":1,"tenantId":"synthetic-carrier","datasetSha256":"<64 lowercase hex>","fileSha256":"<64 lowercase hex>","sampleCount":1}
```

The trainer verifies schema, requested tenant, sample count and SHA-256 of the
exact bytes read, and carries the original dataset digest into its own manifest.
It cannot reconstruct the original dataset digest from an export or determine
whether a message secretly contains held-out data. The Node exporter must
enforce approval and train-only selection; the flag and unsigned sidecar are
not proof of human consent or authorization. Protect both files as trusted
carrier inputs, segregate evaluation documents, and never pass raw uploads.

## Invocation

Invoke Python directly, with argument arrays (`shell: false`) in orchestration:

```text
python3 services/document-learning/training/train.py
  --model /carrier/models/approved-hf-snapshot
  --data /carrier/approved/train.jsonl
  --output /carrier/adapters/new-immutable-version
  --tenant synthetic-carrier --data-approved
  --epochs 1 --max-sequence-length 2048 --max-steps 100 --seed 42
```

Join these displayed arguments into one invocation; this program never launches
a shell. The output parent must already exist, and output must not exist.
Limits: 1-10 epochs, 32-8192 tokens, 1-10000 optimizer steps, seed 0..2^32-1,
LoRA rank 1-64, learning rate (0, 0.01], 1000 examples, 32 MiB total input,
1 MiB per line and 64 messages per example. Both epoch and step caps apply.
Batch size is one; there is no resume, evaluation, distributed launch or hidden
checkpoint path. The single-process optimizer trains CUDA if available,
otherwise CPU in full precision. Size the model for available memory; a seed
does not guarantee identical weights across hardware/library versions.

Offline variables (`HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`,
`HF_DATASETS_OFFLINE`) and telemetry/progress/WandB disable variables are forced
before lazy ML imports. Loaders set `local_files_only=True`,
`trust_remote_code=False` and require safetensors. All library stdout/stderr
(including native file-descriptor writes) and Python logs are suppressed during
the CLI job. Success emits only manifest JSON; failure emits only a fixed JSON
error and exits 1, with no traceback or document details. The Python callable
is an internal interface; invoke the CLI to get the output-suppression boundary.

Environment settings are not a network security boundary. Run in a trusted,
default-deny-egress container/host without unrelated telemetry agents, with
read-only base/input mounts, encrypted tenant-private output, restricted process
inspection, disabled core dumps and an external time/memory budget. CLI sets
umask 077 and creates output mode 0700. Training can memorize sensitive data;
protect adapters as sensitive carrier artifacts and apply approved retention.

## Output And Inference Handoff

Successful output contains only `adapter_config.json`,
`adapter_model.safetensors`, and `manifest.json`. No dataset copy, sample text,
token cache, optimizer state, metrics log, tokenizer or merged base is saved.
An interrupted/failed save can leave an incomplete output directory; a missing
valid manifest means unusable output. Investigate/remove it before a fresh run.

Manifest schema 1 records trainer version, tenant, dataset/export hashes,
relative base-file and adapter-file SHA-256 hashes, aggregate base hash,
bounded parameters, completed steps and actual dependency versions. Base hash
is SHA-256 of the canonical base-file hash map. `manifestSha256` is SHA-256 of
the manifest without that field, serialized with ASCII-escaped strings, sorted
keys, compact separators and no newline. Artifact hashes cover exact bytes;
the manifest file itself ends with a newline. Recompute all digests before
conversion/publication. Hashes are integrity metadata, not signatures.

PEFT output is not an Ollama/GGUF model or automatically deployable release.
In a separate approved offline conversion job, load the exact hashed local HF
base with the adapter, merge via PEFT if the inference engine requires it,
and export using an engine-compatible, pinned converter (for example local
llama.cpp HF-to-GGUF conversion and optional quantization for Ollama). Keep the
matching tokenizer/chat template, record new artifact hashes and conversion
versions, and evaluate the resulting inference artifact on held-out documents.
Never relabel an adapter hash as the converted model hash. Engine conversion,
real-model accuracy, release approval and signed activation remain outside
this subdirectory; training status is explicitly `TRAINED_NOT_EVALUATED`.

## Verification And Handoff

From the repository root:

```text
python3 -B -m unittest discover -s services/document-learning/training -p 'test_*.py' -v
```

Tests use temporary synthetic inputs and standard-library fakes for encoding.
They cover config/input limits, local model enforcement, approval and sidecar
checks, tenant mismatch, malformed exports, resource bounds, deterministic
manifest hashing, artifact changes, assistant-label masking, safe CLI failures,
and ML-free imports. They do not establish GPU training, ML dependency
compatibility, inference conversion or model quality. No actual GPU training
has been verified. Parent Node orchestration and repository-wide docs/tests
are intentionally owned by the main agent, not this adapter change.
