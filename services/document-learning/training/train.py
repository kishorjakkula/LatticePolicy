"""Explicitly approved, local-only causal-LM LoRA training. No ML imports at import time."""

import argparse
from contextlib import contextmanager
from dataclasses import asdict, dataclass
import hashlib
import importlib.metadata
import json
import logging
import math
import os
from pathlib import Path
import re
import sys


VERSION = "1.0.0"
MAX_BYTES = 32 * 1024 * 1024
MAX_EXAMPLES = 1000
MAX_LINE_BYTES = 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}\Z")
OFFLINE_ENV = {
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    "HF_DATASETS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
    "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1", "DO_NOT_TRACK": "1",
    "WANDB_DISABLED": "true", "WANDB_MODE": "disabled",
    "COMET_MODE": "DISABLED", "TOKENIZERS_PARALLELISM": "false",
    "HF_HUB_DISABLE_PROGRESS_BARS": "1", "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
}


class ValidationError(ValueError):
    """Messages must never contain input contents or exception details."""


@dataclass(frozen=True)
class Config:
    model: Path
    data: Path
    output: Path
    tenant: str
    data_approved: bool = False
    epochs: int = 1
    max_sequence_length: int = 2048
    max_steps: int = 100
    seed: int = 42
    lora_rank: int = 8
    learning_rate: float = 0.0002


def validate_config(config):
    if config.data_approved is not True:
        raise ValidationError("Explicit data approval is required")
    if not isinstance(config.tenant, str) or not IDENTIFIER.fullmatch(config.tenant):
        raise ValidationError("Invalid tenant identifier")
    limits = ((config.epochs, 1, 10), (config.max_sequence_length, 32, 8192),
              (config.max_steps, 1, 10000), (config.seed, 0, 2**32 - 1),
              (config.lora_rank, 1, 64))
    if any(type(value) is not int or not low <= value <= high for value, low, high in limits):
        raise ValidationError("Training limits are invalid")
    if (type(config.learning_rate) not in (int, float)
            or not math.isfinite(config.learning_rate)
            or not 0 < config.learning_rate <= 0.01):
        raise ValidationError("Invalid learning rate")
    model = Path(config.model).resolve(strict=True)
    data = Path(config.data).resolve(strict=True)
    output = Path(config.output).absolute()
    if not model.is_dir() or not (model / "config.json").is_file():
        raise ValidationError("A complete local model directory is required")
    if not data.is_file() or data.stat().st_size > MAX_BYTES:
        raise ValidationError("Invalid training file")
    if output.exists() or output.is_symlink():
        raise ValidationError("Output must be a new directory")
    if not output.parent.is_dir():
        raise ValidationError("Output parent must already exist")
    if model == output.resolve() or model in output.resolve().parents:
        raise ValidationError("Output cannot be inside the base model")
    # Single process only: inherited launch configuration must not spawn collectives.
    if any(os.environ.get(key, "1") != "1" for key in ("WORLD_SIZE", "LOCAL_WORLD_SIZE")):
        raise ValidationError("Distributed training is not supported")
    return config


def validate_example(example):
    if not isinstance(example, dict) or set(example) != {"messages"}:
        raise ValidationError("Expected normalized training messages only")
    messages = example["messages"]
    if not isinstance(messages, list) or not 2 <= len(messages) <= 64:
        raise ValidationError("Invalid message count")
    roles = []
    for message in messages:
        if (not isinstance(message, dict) or set(message) != {"role", "content"}
                or message["role"] not in ("system", "user", "assistant")
                or not isinstance(message["content"], str) or not message["content"].strip()
                or len(message["content"]) > 240000):
            raise ValidationError("Invalid training message")
        roles.append(message["role"])
    dialogue = roles[1:] if roles[0] == "system" else roles
    if (len(dialogue) < 2 or len(dialogue) % 2
            or any(role != ("user" if i % 2 == 0 else "assistant")
                   for i, role in enumerate(dialogue))):
        raise ValidationError("Expected alternating user and assistant turns")
    return example


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("Duplicate JSON keys are forbidden")
        result[key] = value
    return result


def read_examples(file):
    examples = []
    digest = hashlib.sha256()
    total = 0
    with Path(file).open("rb") as source:
        while True:
            line = source.readline(MAX_LINE_BYTES + 1)
            if not line:
                break
            total += len(line)
            if total > MAX_BYTES or len(line) > MAX_LINE_BYTES or len(examples) >= MAX_EXAMPLES:
                raise ValidationError("Training input exceeds limits")
            digest.update(line)
            try:
                value = json.loads(line.decode("utf-8"), object_pairs_hook=_unique_object)
                examples.append(validate_example(value))
            except (ValueError, UnicodeError, TypeError):
                raise ValidationError("Invalid training JSONL") from None
    if not examples:
        raise ValidationError("Training input is empty")
    return examples, digest.hexdigest()


def read_approved_export(config):
    examples, file_hash = read_examples(config.data)
    try:
        with Path(str(config.data) + ".manifest.json").open("rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValidationError("Invalid export manifest")
        manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
        if (not isinstance(manifest, dict)
                or set(manifest) != {"schemaVersion", "tenantId", "datasetSha256", "fileSha256", "sampleCount"}
                or type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1
                or manifest["tenantId"] != config.tenant
                or type(manifest["sampleCount"]) is not int or manifest["sampleCount"] != len(examples)
                or not isinstance(manifest["datasetSha256"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", manifest["datasetSha256"])
                or manifest["fileSha256"] != file_hash):
            raise ValidationError("Export manifest does not match training input")
    except (OSError, ValueError, UnicodeError, TypeError):
        raise ValidationError("A matching tenant-scoped export manifest is required") from None
    return examples, manifest


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def file_sha256(file):
    digest = hashlib.sha256()
    with Path(file).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_hashes(directory):
    root = Path(directory).resolve(strict=True)
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() and (path.is_dir() or root not in path.resolve().parents):
            raise ValidationError("Artifact symlinks must not escape the local directory")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = file_sha256(path)
    if not result:
        raise ValidationError("Artifact directory is empty")
    return result


def make_manifest(config, export, base_hashes, adapter_hashes, steps, dependency_versions):
    parameters = asdict(config)
    for key in ("model", "data", "output", "tenant", "data_approved"):
        del parameters[key]
    manifest = {
        "schemaVersion": 1, "trainerVersion": VERSION, "tenantId": config.tenant,
        "kind": "peft-lora", "dataApproved": True,
        "trainingFileSha256": export["fileSha256"], "datasetSha256": export["datasetSha256"],
        "sampleCount": export["sampleCount"],
        "baseModelSha256": hashlib.sha256(canonical_bytes(base_hashes)).hexdigest(),
        "baseModelFiles": base_hashes, "adapterFiles": adapter_hashes,
        "parameters": parameters, "completedSteps": steps,
        "dependencies": dependency_versions, "evaluationPerformed": False,
        "supervision": "final-assistant-response", "status": "TRAINED_NOT_EVALUATED",
    }
    manifest["manifestSha256"] = hashlib.sha256(canonical_bytes(manifest)).hexdigest()
    return manifest


@contextmanager
def quiet_process():
    """Suppress even native library writes; the CLI emits only safe metadata afterward."""
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(fd) for fd in (1, 2)]
    previous = logging.root.manager.disable
    try:
        with open(os.devnull, "w") as sink:
            for fd in (1, 2):
                os.dup2(sink.fileno(), fd)
            logging.disable(logging.CRITICAL)
            yield
    finally:
        # Flush while still redirected, including when a library raises midway.
        sys.stdout.flush()
        sys.stderr.flush()
        for fd, backup in zip((1, 2), saved):
            os.dup2(backup, fd)
            os.close(backup)
        logging.disable(previous)


def encode_example(tokenizer, example, maximum):
    messages = example["messages"]
    prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=True,
                                            add_generation_prompt=True)
    complete = tokenizer.apply_chat_template(messages, tokenize=True,
                                              add_generation_prompt=False)
    # Never truncate away an approved target or guess token boundaries.
    if (len(complete) > maximum or not prompt or complete[:len(prompt)] != prompt
            or len(complete) <= len(prompt)):
        raise ValidationError("Chat template or sequence length is incompatible")
    return {"input_ids": complete,
            "labels": [-100] * len(prompt) + complete[len(prompt):]}


def train(config):
    validate_config(config)
    examples, export = read_approved_export(config)
    base_hashes = artifact_hashes(config.model)
    os.environ.update(OFFLINE_ENV)
    # Import only after approval, input validation, and forced offline settings.
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed
    from peft import LoraConfig, TaskType, get_peft_model

    set_seed(config.seed)
    torch.use_deterministic_algorithms(True)
    model_path = str(Path(config.model).resolve())
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True,
                                              trust_remote_code=False)
    if not tokenizer.chat_template:
        raise ValidationError("An approved local chat template is required")
    encoded = [encode_example(tokenizer, example, config.max_sequence_length)
               for example in examples]
    model = AutoModelForCausalLM.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False, use_safetensors=True)
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        task_type=TaskType.CAUSAL_LM, r=config.lora_rank,
        lora_alpha=config.lora_rank * 2, lora_dropout=0.0,
        target_modules="all-linear", bias="none"))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.train()
    parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(parameters, lr=config.learning_rate)
    # Both limits apply; max_steps never causes additional epochs.
    steps = 0
    for _ in range(config.epochs):
        for index in torch.randperm(len(encoded)).tolist():
            row = encoded[index]
            batch = {key: torch.tensor([value], dtype=torch.long, device=device)
                     for key, value in row.items()}
            batch["attention_mask"] = torch.ones_like(batch["input_ids"])
            optimizer.zero_grad(set_to_none=True)
            loss = model(**batch).loss
            if not torch.isfinite(loss).item():
                raise ValidationError("Training produced a non-finite loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
            optimizer.step()
            steps += 1
            if steps >= config.max_steps:
                break
        if steps >= config.max_steps:
            break
    if artifact_hashes(config.model) != base_hashes:
        raise ValidationError("Local base artifacts changed during training")
    output = Path(config.output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    # PEFT only: no optimizer, checkpoints, dataset cache, tokenizer or merged base.
    model.save_pretrained(str(output), safe_serialization=True, save_embedding_layers=False)
    card = output / "README.md"
    if card.exists():
        card.unlink()
    hashes = artifact_hashes(output)
    if set(hashes) != {"adapter_config.json", "adapter_model.safetensors"}:
        raise ValidationError("Unexpected adapter output")
    versions = {name: importlib.metadata.version(name)
                for name in ("torch", "transformers", "peft", "accelerate", "safetensors")}
    manifest = make_manifest(config, export, base_hashes, hashes, steps, versions)
    with (output / "manifest.json").open("xb") as target:
        target.write(canonical_bytes(manifest) + b"\n")
    return manifest


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--model", required=True, type=Path)
    cli.add_argument("--data", required=True, type=Path)
    cli.add_argument("--output", required=True, type=Path)
    cli.add_argument("--tenant", required=True)
    cli.add_argument("--data-approved", action="store_true", required=True)
    cli.add_argument("--epochs", type=int, default=1)
    cli.add_argument("--max-sequence-length", type=int, default=2048)
    cli.add_argument("--max-steps", type=int, default=100)
    cli.add_argument("--seed", type=int, default=42)
    cli.add_argument("--lora-rank", type=int, default=8)
    cli.add_argument("--learning-rate", type=float, default=0.0002)
    return cli


def main(argv=None):
    os.umask(0o077)
    try:
        # Parsing is quiet too: argparse errors can otherwise echo arbitrary input.
        with quiet_process():
            config = Config(**vars(parser().parse_args(argv)))
            manifest = train(config)
    except (Exception, SystemExit):
        sys.stderr.write('{"error":"offline_training_failed"}\n')
        return 1
    sys.stdout.write(json.dumps(manifest, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
