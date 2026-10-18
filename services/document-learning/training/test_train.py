"""Synthetic stdlib-only contract tests; no model, ML imports, GPU or network."""

from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import train


EXAMPLE = {"messages": [
    {"role": "system", "content": "Extract synthetic facts."},
    {"role": "user", "content": "Synthetic applicant: Example LLC"},
    {"role": "assistant", "content": '{"name":"Example LLC"}'},
]}


class TrainingContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.model = self.root / "model"
        self.model.mkdir()
        (self.model / "config.json").write_text("{}")
        self.data = self.root / "train.jsonl"
        self.data.write_bytes((json.dumps(EXAMPLE) + "\n").encode())
        self.export = {"schemaVersion": 1, "tenantId": "synthetic-carrier",
                       "datasetSha256": "a" * 64, "sampleCount": 1,
                       "fileSha256": train.file_sha256(self.data)}
        self.sidecar = Path(str(self.data) + ".manifest.json")
        self.write_sidecar()
        self.config = train.Config(self.model, self.data, self.root / "adapter",
                                   "synthetic-carrier", data_approved=True)

    def write_sidecar(self):
        self.sidecar.write_text(json.dumps(self.export))

    def test_valid_config_and_export(self):
        self.assertEqual(train.validate_config(self.config), self.config)
        examples, export = train.read_approved_export(self.config)
        self.assertEqual(examples, [EXAMPLE])
        self.assertEqual(export, self.export)

    def test_approval_required(self):
        with self.assertRaises(train.ValidationError):
            train.validate_config(replace(self.config, data_approved=False))

    def test_tenant_validation(self):
        for tenant in ("", "../tenant", "tenant\n", "a" * 101, None):
            with self.subTest(tenant=tenant), self.assertRaises(train.ValidationError):
                train.validate_config(replace(self.config, tenant=tenant))

    def test_bounded_configuration(self):
        invalid = {"epochs": (0, 11, True), "max_steps": (0, 10001),
                   "max_sequence_length": (31, 8193), "seed": (-1, 2**32),
                   "lora_rank": (0, 65), "learning_rate": (0, 0.1, float("nan"), float("inf"), True)}
        for field, values in invalid.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(train.ValidationError):
                    train.validate_config(replace(self.config, **{field: value}))

    def test_remote_model_rejected(self):
        for model in (self.root / "org/model", Path("https:/example.invalid/model")):
            with self.assertRaises((OSError, train.ValidationError)):
                train.validate_config(replace(self.config, model=model))

    def test_existing_output_rejected(self):
        self.config.output.mkdir()
        with self.assertRaises(train.ValidationError):
            train.validate_config(self.config)

    def test_output_inside_base_rejected(self):
        with self.assertRaises(train.ValidationError):
            train.validate_config(replace(self.config, output=self.model / "adapter"))

    def test_missing_output_parent_rejected(self):
        with self.assertRaises(train.ValidationError):
            train.validate_config(replace(self.config, output=self.root / "missing" / "adapter"))

    def test_distributed_launch_rejected(self):
        with patch.dict(os.environ, {"WORLD_SIZE": "2"}):
            with self.assertRaises(train.ValidationError):
                train.validate_config(self.config)

    def test_sidecar_required(self):
        self.sidecar.unlink()
        with self.assertRaises(train.ValidationError):
            train.read_approved_export(self.config)

    def test_sidecar_identity_and_digest_validation(self):
        for key, value in (("tenantId", "other-carrier"), ("schemaVersion", 2),
                           ("schemaVersion", True), ("sampleCount", 2), ("sampleCount", True),
                           ("fileSha256", "b" * 64), ("datasetSha256", "not-a-hash")):
            original = self.export[key]
            with self.subTest(key=key, value=value):
                self.export[key] = value
                self.write_sidecar()
                with self.assertRaises(train.ValidationError):
                    train.read_approved_export(self.config)
            self.export[key] = original

    def test_changed_bytes_rejected(self):
        self.data.write_bytes(self.data.read_bytes() + b" ")
        with self.assertRaises(train.ValidationError):
            train.read_approved_export(self.config)

    def test_sidecar_malformed_duplicate_and_oversized(self):
        for raw in (b"{", b"[]", b'{"tenantId":"a","tenantId":"b"}', b" " * 65537):
            self.sidecar.write_bytes(raw)
            with self.assertRaises(train.ValidationError):
                train.read_approved_export(self.config)

    def test_malformed_or_empty_jsonl(self):
        for raw in (b"", b"\n", b"{", b"\xff", b"null\n", b"[]\n",
                    b'{"messages":[],"messages":[]}\n'):
            self.data.write_bytes(raw)
            with self.subTest(raw=raw), self.assertRaises(train.ValidationError):
                train.read_examples(self.data)

    def test_non_training_wrappers_rejected(self):
        for extra in ({"split": "evaluation"}, {"documents": []}, {"tenantId": "other"}):
            with self.assertRaises(train.ValidationError):
                train.validate_example({**EXAMPLE, **extra})

    def test_invalid_messages(self):
        invalid = [[], [{"role": "assistant", "content": "x"}],
                   [{"role": "user", "content": ""}, EXAMPLE["messages"][-1]],
                   [{"role": "tool", "content": "x"}, EXAMPLE["messages"][-1]],
                   [EXAMPLE["messages"][1], {"role": "assistant", "content": 42}],
                   [EXAMPLE["messages"][1], {"role": "system", "content": "x"}],
                   [EXAMPLE["messages"][1], {"role": "assistant", "content": "x", "extra": 1}]]
        for messages in invalid:
            with self.subTest(messages=messages), self.assertRaises(train.ValidationError):
                train.validate_example({"messages": messages})

    def test_input_resource_limits(self):
        for limit in ("MAX_BYTES", "MAX_LINE_BYTES", "MAX_EXAMPLES"):
            with patch.object(train, limit, 0):
                with self.assertRaises(train.ValidationError):
                    train.read_examples(self.data)

    def test_hashes_track_content_and_relative_names(self):
        expected = hashlib.sha256(b"{}").hexdigest()
        self.assertEqual(train.artifact_hashes(self.model), {"config.json": expected})
        (self.model / "config.json").write_bytes(b"changed")
        self.assertNotEqual(train.artifact_hashes(self.model)["config.json"], expected)

    def test_escaping_artifact_symlink_rejected(self):
        (self.model / "escape").symlink_to(self.data)
        with self.assertRaises(train.ValidationError):
            train.artifact_hashes(self.model)

    def test_manifest_hash_and_provenance(self):
        manifest = train.make_manifest(self.config, self.export, {"config.json": "b" * 64},
                                       {"adapter_model.safetensors": "c" * 64}, 1, {})
        claimed = manifest.pop("manifestSha256")
        self.assertEqual(claimed, hashlib.sha256(train.canonical_bytes(manifest)).hexdigest())
        self.assertEqual(manifest["tenantId"], self.config.tenant)
        self.assertEqual(manifest["datasetSha256"], self.export["datasetSha256"])
        self.assertFalse(manifest["evaluationPerformed"])
        self.assertNotIn(str(self.data), json.dumps(manifest))
        self.assertNotIn(EXAMPLE["messages"][1]["content"], json.dumps(manifest))
        manifest["completedSteps"] = 2
        self.assertNotEqual(claimed, hashlib.sha256(train.canonical_bytes(manifest)).hexdigest())

    def test_encoding_masks_prompt_and_preserves_target(self):
        class Tokenizer:
            def apply_chat_template(self, messages, tokenize, add_generation_prompt):
                return [1, 2] if add_generation_prompt else [1, 2, 3, 4]
        encoded = train.encode_example(Tokenizer(), EXAMPLE, 32)
        self.assertEqual(encoded["labels"], [-100, -100, 3, 4])
        with self.assertRaises(train.ValidationError):
            train.encode_example(Tokenizer(), EXAMPLE, 3)

    def test_encoding_rejects_incompatible_template(self):
        class Tokenizer:
            def apply_chat_template(self, messages, tokenize, add_generation_prompt):
                return [9] if add_generation_prompt else [1, 2]
        with self.assertRaises(train.ValidationError):
            train.encode_example(Tokenizer(), EXAMPLE, 32)

    def test_cli_required_flags_and_safe_error(self):
        command = [sys.executable, "-B", str(Path(train.__file__).resolve()),
                   "--model", str(self.model), "--data", str(self.data),
                   "--output", str(self.config.output), "--tenant", self.config.tenant]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, '{"error":"offline_training_failed"}\n')
        result = subprocess.run(command + ["--data-approved", "--epochs", "0"],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertNotIn(str(self.data), result.stderr)

    def test_validation_does_not_import_ml(self):
        # A fresh interpreter makes this independent of the test process environment.
        code = ("import sys; import train; "
                "assert not {'torch','transformers','peft','accelerate'} & set(sys.modules)")
        result = subprocess.run([sys.executable, "-B", "-c", code],
                                cwd=Path(train.__file__).parent, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)

    def test_quiet_failure_suppresses_buffered_and_native_output(self):
        code = ("import train,os\ntry:\n with train.quiet_process():\n"
                "  print('PRIVATE_SYNTHETIC_MARKER',end='')\n"
                "  os.write(2,b'PRIVATE_SYNTHETIC_MARKER')\n"
                "  raise ValueError()\nexcept ValueError: pass\nprint('safe')")
        result = subprocess.run([sys.executable, "-B", "-c", code],
                                cwd=Path(train.__file__).parent, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "safe\n")
        self.assertEqual(result.stderr, "")

    def test_mocked_training_caps_local_loaders_and_adapter_only_save(self):
        self.data.write_bytes(self.data.read_bytes() * 2)
        self.export.update(sampleCount=2, fileSha256=train.file_sha256(self.data))
        self.write_sidecar()
        calls = []

        class Tokenizer:
            chat_template = "approved synthetic template"

            @staticmethod
            def from_pretrained(path, **kwargs):
                calls.append(("tokenizer", path, kwargs))
                return Tokenizer()

            def apply_chat_template(self, messages, tokenize, add_generation_prompt):
                return [1, 2] if add_generation_prompt else [1, 2, 3]

        class Model:
            config = SimpleNamespace(use_cache=True)

            @staticmethod
            def from_pretrained(path, **kwargs):
                calls.append(("model", path, kwargs))
                return Model()

            def to(self, device):
                pass

            def train(self):
                pass

            def parameters(self):
                return [SimpleNamespace(requires_grad=True)]

            def __call__(self, **batch):
                calls.append(("batch", batch))
                return SimpleNamespace(loss=SimpleNamespace(backward=lambda: None))

            def save_pretrained(self, output, **kwargs):
                calls.append(("save", kwargs))
                Path(output, "adapter_config.json").write_bytes(b"{}")
                Path(output, "adapter_model.safetensors").write_bytes(b"synthetic-test-only")
                Path(output, "README.md").write_text("synthetic model card")

        optimizer = SimpleNamespace(zero_grad=lambda **kw: None, step=lambda: None)
        torch = SimpleNamespace(
            use_deterministic_algorithms=lambda value: None,
            cuda=SimpleNamespace(is_available=lambda: False), device=lambda value: value,
            optim=SimpleNamespace(AdamW=lambda *args, **kwargs: optimizer),
            randperm=lambda size: SimpleNamespace(tolist=lambda: list(range(size))),
            tensor=lambda value, **kwargs: value, long="long", ones_like=lambda value: value,
            isfinite=lambda value: SimpleNamespace(item=lambda: True),
            nn=SimpleNamespace(utils=SimpleNamespace(clip_grad_norm_=lambda *a, **kw: None)))
        transformers = SimpleNamespace(AutoTokenizer=Tokenizer, AutoModelForCausalLM=Model,
                                       set_seed=lambda seed: None)
        peft = SimpleNamespace(LoraConfig=lambda **kwargs: kwargs,
                               TaskType=SimpleNamespace(CAUSAL_LM="CAUSAL_LM"),
                               get_peft_model=lambda model, config: model)
        with patch.dict(sys.modules, torch=torch, transformers=transformers, peft=peft), \
                patch.dict(os.environ), patch.object(train.importlib.metadata, "version", return_value="test"):
            for maximum, expected in ((3, 3), (10, 4)):
                calls.clear()
                output = self.root / ("adapter-" + str(maximum))
                manifest = train.train(replace(self.config, epochs=2, max_steps=maximum, output=output))
                self.assertEqual(manifest["completedSteps"], expected)
                self.assertEqual(len([call for call in calls if call[0] == "batch"]), expected)
                for name in ("model", "tokenizer"):
                    call = next(call for call in calls if call[0] == name)
                    self.assertTrue(call[2]["local_files_only"])
                    self.assertFalse(call[2]["trust_remote_code"])
                self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
                self.assertEqual(os.environ["WANDB_MODE"], "disabled")
                self.assertEqual({path.name for path in output.iterdir()},
                                 {"adapter_config.json", "adapter_model.safetensors", "manifest.json"})
                self.assertEqual(json.loads((output / "manifest.json").read_text()), manifest)


if __name__ == "__main__":
    unittest.main()
