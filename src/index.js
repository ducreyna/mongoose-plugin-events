import {get, isObject, isFunction} from 'lodash';
import relayMongoEvents from './relay';

export {relayMongoEvents};

const isObjectId = maybeObjectId => isObject(maybeObjectId) && isFunction(maybeObjectId.getTimestamp);

export default function eventsPlugin(schema, {ignoredPaths = ['updatedAt', 'createdAt']}) {
  //
  // Helper to emit on both model/document and schema for easier cross plugin interactions
  schema.methods.$emit = function emit(eventName, ...args) {
    this.schema.emit(`doc:${eventName}`, ...args.concat(this));
    return this.emit(eventName, ...args);
  };
  schema.statics.$emit = function emit(eventName, ...args) {
    this.schema.emit(`model:${eventName}`, ...args.concat(this));
    return this.emit(eventName, ...args);
  };

  // Handle document creation
  schema.pre('save', function preSave(next) {
    this.$wasNew = this.isNew;
    next();
  });
  schema.post('save', function postSave(doc, next) {
    const model = doc.model(doc.constructor.modelName);
    if (this.$wasNew) {
      const object = doc.toObject();
      // d('emit:created', object);
      model.$emit('created', object);
    } else {
      const modifiedPaths = doc.modifiedPaths();
      if (modifiedPaths) {
        const object = doc.toObject();
        // d('emit:updated', object);
        model.$emit('updated', object);
        modifiedPaths.forEach((pathName) => {
          if (ignoredPaths.includes(pathName)) {
            return;
          }
          const eventKey = `updated:${pathName}`;
          // d(`emit:${eventKey}`, {_id: object._id, [pathName]: get(object, pathName)});
          model.$emit(eventKey, {_id: object._id, [pathName]: get(object, pathName)});
        });
      }
    }
    next();
  });

  const updateOperators = [
    '$inc', '$mul', '$rename', '$set', '$unset', '$min', '$max', '$addToSet', '$pop', '$pullAll', '$pull', '$pushAll', '$push'
  ];
  function preUpdate(next) {
    this.$wasQuery = this.getQuery();
    this.$wasUpdate = this.getUpdate();
    next();
  }
  function postUpdate(res, next) {
    const query = this.$wasQuery;
    const update = this.$wasUpdate;
    const model = this.model;
    const wasUpdated = updateOperators.reduce((soFar, operator) =>
      soFar || (update[operator] && (Object.keys(update[operator]).length > 0))
      , false);
    if (wasUpdated) {
      // Flatten $set
      const flatUpdate = Object.keys(update).reduce((soFar, key) =>
        Object.assign(soFar, key === '$set' ? update[key] : {[key]: update[key]})
        , query && query._id ? {_id: query._id} : {});
      // Emit updated event
      model.$emit('updated', {query, update: flatUpdate});
      updateOperators.forEach((operator) => {
        if (update[operator]) {
          const modifiedPaths = Object.keys(update[operator]);
          modifiedPaths.forEach((pathName) => {
            if (ignoredPaths.includes(pathName)) {
              return;
            }
            const eventKey = `updated:${pathName}`;
            if (query && isObjectId(query._id)) {
              const fieldUpdate = {_id: query._id, [pathName]: get(update[operator], pathName)};
              model.$emit(eventKey, {query, operator, update: fieldUpdate});
            } else {
              // d('@TODO', query, update)
            }
          });
        }
      });
    }
    next();
  }
  schema.pre('update', preUpdate);
  schema.pre('findOneAndUpdate', preUpdate);
  schema.post('update', postUpdate);
  schema.post('findOneAndUpdate', postUpdate);

  schema.post('remove', function postRemove() {
    const doc = this;
    const model = doc.model(doc.constructor.modelName);
    const object = doc.toObject();
    model.$emit('removed', object);
  });

  // Prepare potential relays
  schema.statics.$on = function modelOnListener(eventName, callback = () => {}) {
    return this.on(eventName, callback);
  };
  schema.$on = function schemaOnListener(eventName, callback = () => {}) {
    return this.on(eventName, callback);
  };
  schema.statics.$once = function modelOnceListener(eventName, callback = () => {}) {
    return this.once(eventName, callback);
  };
  schema.$once = function schemaOnceListener(eventName, callback = () => {}) {
    return this.once(eventName, callback);
  };
}
