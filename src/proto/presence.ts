// Field presence for the proto2 messages of the event log (upstream's
// `proto.has_x()`); protobuf-es exposes unset optional fields as defaults.

import {type DescMessage, isFieldSet, type MessageShape} from "@bufbuild/protobuf";

export function has<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
  field: string & keyof MessageShape<Desc>,
): boolean {
  const desc = schema.field[field];
  if (desc === undefined) throw new Error(`${schema.typeName} has no field ${field}`);
  return isFieldSet(message, desc);
}
