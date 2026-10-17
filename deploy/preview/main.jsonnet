local postgres = import 'lib/postgres.libsonnet';
local storage = import 'lib/storage.libsonnet';

// Argo CD supplies these as Jsonnet top-level arguments (TLAs).
function(prNumber, namespace=null, awsAccountId='440027025698', awsRegion='eu-north-1', environment='dev', postgresStorageSize='5Gi')
  local digits = '0123456789';
  local lower = 'abcdefghijklmnopqrstuvwxyz';
  local containsOnly(value, allowed) =
    std.length(std.filter(function(c) !std.member(std.stringChars(allowed), c), std.stringChars(value))) == 0;
  local isNamespace(value) =
    std.type(value) == 'string' && std.length(value) > 0 && std.length(value) <= 63 &&
    containsOnly(value, lower + digits + '-') && value[0] != '-' && value[std.length(value) - 1] != '-';
  local ns = if namespace == null then 'skjera-pr-' + prNumber else namespace;
  local config = {
    prNumber: prNumber,
    previewId: 'pr-' + prNumber,
    namespace: ns,
    awsAccountId: awsAccountId,
    awsRegion: awsRegion,
    environment: environment,
    postgresStorageSize: postgresStorageSize,
  };
  assert std.type(prNumber) == 'string' && std.length(prNumber) > 0 && std.length(prNumber) <= 9 &&
         containsOnly(prNumber, digits) && prNumber[0] != '0'
         : 'prNumber must be a positive PR number, supplied as a string, with at most nine digits';
  assert isNamespace(ns) : 'namespace must be a valid Kubernetes DNS label';
  assert std.type(awsAccountId) == 'string' && std.length(awsAccountId) == 12 && containsOnly(awsAccountId, digits)
         : 'awsAccountId must contain exactly twelve digits';
  assert std.type(environment) == 'string' && std.length(environment) > 0 && std.length(environment) <= 10 &&
         std.member(std.stringChars(lower), environment[0]) && containsOnly(environment, lower + digits + '-')
         : 'environment must start with a lowercase letter and contain at most ten lowercase letters, digits or hyphens';
  assert std.type(awsRegion) == 'string' && std.length(awsRegion) > 0 : 'awsRegion is required';
  assert std.type(postgresStorageSize) == 'string' && std.length(postgresStorageSize) > 0 : 'postgresStorageSize is required';
  storage(config) + postgres(config)
