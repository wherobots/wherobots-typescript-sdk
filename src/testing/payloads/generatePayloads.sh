#!/usr/bin/env bash

# Run this script to generate arrow files and their Brotli-compressed equivalents 
# from json all files in the same directory

if ! command -v json2arrow &> /dev/null
then
    brew install domoritz/homebrew-tap/json2arrow
fi
if ! command -v jq &> /dev/null
then
    brew install jq
fi
if ! command -v brotli &> /dev/null
then
    brew install brotli
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

for f in $DIR/*.json; do
  # use `jq` to convert json array to line-delimited json
  jq -c '.[]' $f > ${f%.json}.ldjson
  json2arrow ${f%.json}.ldjson >> ${f%.json}.arrow
  rm ${f%.json}.ldjson
done

for f in $DIR/*.arrow; do
  brotli $f -f -o ${f%.arrow}.br
done