#!/usr/bin/env node
import { launchCli } from 'lumasite/src/bootstrap.mjs';

process.exitCode = await launchCli(['create', ...process.argv.slice(2)]);
