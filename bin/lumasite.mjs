#!/usr/bin/env node
import { launchCli } from '../src/bootstrap.mjs';

process.exitCode = await launchCli(process.argv.slice(2));
