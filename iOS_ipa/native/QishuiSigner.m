// Native network integration for the first-party VolMetaSecML SDK.
// The SDK is separately obtained from volcengine/volcengine-specs. No license,
// Cookie, device account or signing output is embedded in this source file.
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>
#import "MSConfig.h"
#import "MSManager.h"
#include <string.h>
#include <stdio.h>

typedef NSDictionary * _Nullable (^MRHTTPFactor)(NSURL *, NSDictionary *);
static MRHTTPFactor MRFactor;
static NSUInteger MRFactorInstalls;
static NSMutableArray *MRResponseFilters;
static BOOL MRRequestFilterEnabled;
static NSDictionary *MRConfiguration;
static id MRManager;
static NSString *MRFailure;
static NSString *MRFailureException;
static NSString *MRMissingNetworkSelector;
static NSUInteger MRSignCount;
static BOOL MRInitializing;
static NSString *MRStageValue = @"not_started";
static NSMutableDictionary *MRBlockTypes;

static NSObject *MRStageLock(void) {
    static NSObject *lock;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ lock = [NSObject new]; });
    return lock;
}

static BOOL MRProbeEnabled(void) {
    return [NSProcessInfo.processInfo.environment[@"MINERADIO_IOS_SIGNER_PROBE"] isEqualToString:@"1"];
}

static NSDictionary *MRSelectorTypes(void) {
    NSMutableDictionary *result = [NSMutableDictionary new];
    NSDictionary *selectors = @{
        @"MSConfigML": @[@"initWithAppID:License:Mode:", @"setClientType", @"setChannel", @"setDeviceID"],
        @"MSManagerML": @[@"initWithConfig:", @"whoisGame:withType:"]
    };
    for (NSString *name in selectors) {
        Class cls = NSClassFromString(name);
        for (NSString *selector in selectors[name]) {
            Method method = cls ? class_getInstanceMethod(cls, NSSelectorFromString(selector)) : NULL;
            const char *encoding = method ? method_getTypeEncoding(method) : NULL;
            result[[NSString stringWithFormat:@"%@.%@", name, selector]] = encoding
                ? [NSString stringWithUTF8String:encoding] : @"absent";
        }
    }
    return result;
}

static void MRStage(NSString *stage) {
    @synchronized (MRStageLock()) { MRStageValue = stage; }
    if (!MRProbeEnabled()) return;
    NSString *directory = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    if (!directory) return;
    [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *blocks;
    @synchronized (MRStageLock()) { blocks = [MRBlockTypes copy] ?: @{}; }
    NSDictionary *record = @{ @"stage": stage, @"mainThread": @(NSThread.isMainThread),
        @"timestamp": @(NSDate.date.timeIntervalSince1970),
        @"selectorABI": MRSelectorTypes(), @"blockABI": blocks };
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
    [data writeToFile:[directory stringByAppendingPathComponent:@"qishui-signer-stage.json"] atomically:YES];
}

// Read only the standard Apple Block descriptor type encoding, never captured
// values. This diagnostic is intentionally disabled for ordinary app operation.
static void MRRecordBlockABI(NSString *name, id block) {
    if (!block) return;
    NSString *kind = NSStringFromClass([block class]);
    if ([kind rangeOfString:@"Block"].location == NSNotFound)
        @throw [NSException exceptionWithName:@"MRSDKBlockABI" reason:@"Setter did not return an Objective-C Block" userInfo:nil];
    if (!MRProbeEnabled()) return;
    struct MRBlockLiteral {
        const void *isa;
        int flags;
        int reserved;
        const void *invoke;
        const void *descriptor;
    };
    const struct MRBlockLiteral *literal = (__bridge const void *)block;
    NSString *signature = @"not_advertised";
    if (literal->descriptor && (literal->flags & (1 << 30))) {
        const unsigned char *descriptor = literal->descriptor;
        descriptor += 2 * sizeof(unsigned long);
        if (literal->flags & (1 << 25)) descriptor += 2 * sizeof(void *);
        const char *encoding = *(const char * const *)descriptor;
        if (encoding) {
            size_t length = strnlen(encoding, 512);
            if (length < 512) signature = [[NSString alloc] initWithBytes:encoding length:length encoding:NSUTF8StringEncoding] ?: @"non_utf8";
        }
    }
    @synchronized (MRStageLock()) {
        if (!MRBlockTypes) MRBlockTypes = [NSMutableDictionary new];
        MRBlockTypes[name] = @{ @"class": kind, @"encoding": signature };
    }
}

// MetaSec integrates with the host network stack by installing this callback.
// These are the selectors and block ABI observed in the distributed iOS SDK.
@interface TTNetworkManager : NSObject
+ (instancetype)shareInstance;
+ (instancetype)sharedInstance;
- (void)setAddSecurityFactorBlock:(MRHTTPFactor)block;
- (MRHTTPFactor)addSecurityFactorBlock;
- (void)addResponseFilterBlock:(id)block;
- (void)setEnableReqFilter:(BOOL)enabled;
- (BOOL)enableReqFilter;
@end

@implementation TTNetworkManager
+ (instancetype)shareInstance {
    static TTNetworkManager *instance;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ instance = [TTNetworkManager new]; });
    return instance;
}
+ (instancetype)sharedInstance { return [self shareInstance]; }
- (void)setAddSecurityFactorBlock:(MRHTTPFactor)block {
    @synchronized ([TTNetworkManager class]) {
        MRFactor = [block copy];
        MRFactorInstalls++;
    }
}
- (MRHTTPFactor)addSecurityFactorBlock {
    @synchronized ([TTNetworkManager class]) { return MRFactor; }
}
- (void)addResponseFilterBlock:(id)block {
    if (!block) return;
    @synchronized ([TTNetworkManager class]) {
        if (!MRResponseFilters) MRResponseFilters = [NSMutableArray new];
        [MRResponseFilters addObject:[block copy]];
    }
}
- (void)setEnableReqFilter:(BOOL)enabled {
    // BOOL ABI is verified against the first-party TTNet 13_4.0.29.18-tob
    // headers retained in its DWARF. This stores the SDK's requested state;
    // it does not fabricate a request or a signing callback.
    @synchronized ([TTNetworkManager class]) { MRRequestFilterEnabled = enabled; }
}
- (BOOL)enableReqFilter {
    @synchronized ([TTNetworkManager class]) { return MRRequestFilterEnabled; }
}
@end

static NSDictionary *MRResult(BOOL ok, NSString *error) {
    return error ? @{ @"ok": @(ok), @"error": error } : @{ @"ok": @(ok) };
}

static BOOL MRString(id value, NSUInteger limit) {
    return [value isKindOfClass:NSString.class] && [value length] > 0 && [value length] <= limit;
}

static void MRIntSetting(id receiver, NSString *getter, NSInteger value) {
    SEL selector = NSSelectorFromString(getter);
    if (![receiver respondsToSelector:selector])
        @throw [NSException exceptionWithName:@"MRSDKInterface" reason:@"Required configuration setter is absent" userInfo:nil];
    MRStage([getter stringByAppendingString:@"_getter"]);
    id (^block)(NSInteger) = ((id (*)(id, SEL))objc_msgSend)(receiver, selector);
    MRRecordBlockABI(getter, block);
    MRStage([getter stringByAppendingString:@"_block"]);
    if (block) block(value);
    MRStage([getter stringByAppendingString:@"_finished"]);
}

static void MRStringSetting(id receiver, NSString *getter, NSString *value) {
    if (!MRString(value, 4096)) return;
    SEL selector = NSSelectorFromString(getter);
    if (![receiver respondsToSelector:selector])
        @throw [NSException exceptionWithName:@"MRSDKInterface" reason:@"Required configuration setter is absent" userInfo:nil];
    MRStage([getter stringByAppendingString:@"_getter"]);
    id (^block)(NSString *) = ((id (*)(id, SEL))objc_msgSend)(receiver, selector);
    MRRecordBlockABI(getter, block);
    MRStage([getter stringByAppendingString:@"_block"]);
    if (block) block(value);
    MRStage([getter stringByAppendingString:@"_finished"]);
}

@interface MineradioQishuiSigner : NSObject
+ (NSDictionary *)configure:(NSDictionary *)configuration;
+ (NSDictionary *)enable;
+ (NSDictionary *)signURL:(NSString *)url headers:(NSDictionary *)headers;
+ (NSDictionary *)status;
+ (NSDictionary *)diagnostic:(NSDictionary *)configuration;
@end

@implementation MineradioQishuiSigner
+ (NSDictionary *)configure:(NSDictionary *)configuration {
    @synchronized (self) {
        if (![configuration isKindOfClass:NSDictionary.class]
            || !MRString(configuration[@"appId"], 128)
            || !MRString(configuration[@"license"], 32768))
            return MRResult(NO, @"signer_configuration_invalid");
        if (MRManager && ![MRConfiguration isEqualToDictionary:configuration])
            return MRResult(NO, @"signer_restart_required");
        if (MRInitializing) return MRResult(NO, @"signer_initialization_in_progress");
        MRConfiguration = [configuration copy];
        MRFailure = nil;
        MRFailureException = nil;
        MRMissingNetworkSelector = nil;
        // Configuration deliberately does not initialize the SDK. This keeps
        // an incompatible license from crashing the app during normal startup.
        return [self status];
    }
}

+ (NSDictionary *)enable {
    NSDictionary *configuration;
    @synchronized (self) {
        if (!MRConfiguration) return MRResult(NO, @"signer_not_configured");
        if (MRManager) return [self status];
        if (MRInitializing) return [self status];
        configuration = [MRConfiguration copy];
        MRInitializing = YES;
    }
    // Never retain the signer state monitor while dispatching across queues or
    // entering third-party code. status/configure must remain independently usable.
    Class configClass = NSClassFromString(@"MSConfigML");
    Class managerClass = NSClassFromString(@"MSManagerML");
    if (!configClass || !managerClass) {
        @synchronized (self) { MRInitializing = NO; }
        return MRResult(NO, @"signer_library_missing");
    }
    BOOL agreed = [configuration[@"privacyAgreed"] isKindOfClass:NSNumber.class]
        && [configuration[@"privacyAgreed"] boolValue];
    if (!agreed && MRString(configuration[@"deviceId"], 4096)) {
        @synchronized (self) { MRInitializing = NO; }
        return MRResult(NO, @"signer_privacy_consent_required");
    }
    __block id manager;
    __block NSString *failure;
    __block NSString *exceptionType;
    __block NSString *missingSelector;
    void (^initialize)(void) = ^{
        @autoreleasepool {
        @try {
            MRStage(@"initializer_entered");
            NSInteger mode = [configuration[@"collectMode"] isKindOfClass:NSNumber.class]
                ? [configuration[@"collectMode"] integerValue] : 290;
            NSInteger client = [configuration[@"clientType"] isKindOfClass:NSNumber.class]
                ? [configuration[@"clientType"] integerValue] : 1;
            MRStage(@"config_alloc");
            MSConfigML *instance = [MSConfigML alloc];
            MRStage(@"config_init");
            MSConfigML *config = [instance initWithAppID:configuration[@"appId"]
                License:configuration[@"license"] Mode:(MSMLCollectMode)mode];
            MRStage(@"config_initialized");
            if (!config) { failure = @"signer_configuration_rejected"; return; }
            MRIntSetting(config, @"setClientType", client);
            MRStringSetting(config, @"setChannel", configuration[@"channel"] ?: @"App Store");
            if (agreed) {
                MRStringSetting(config, @"setDeviceID", configuration[@"deviceId"]);
                MRStringSetting(config, @"setInstallID", configuration[@"installId"]);
                MRStringSetting(config, @"setBDDeviceID", configuration[@"bdDeviceId"]);
            }
            MRStage(@"manager_alloc");
            MSManagerML *object = [MSManagerML alloc];
            MRStage(@"manager_init");
            manager = [object initWithConfig:config];
            MRStage(@"manager_initialized");
            if (!manager) failure = @"signer_initialization_rejected";
        } @catch (NSException *exception) {
            failure = @"signer_initialization_failed";
            exceptionType = exception.name;
            NSString *reason = exception.reason ?: @"";
            NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"TTNetworkManager ([A-Za-z_:0-9]+)" options:0 error:nil];
            NSTextCheckingResult *match = [pattern firstMatchInString:reason options:0 range:NSMakeRange(0, reason.length)];
            if (match.numberOfRanges == 2)
                missingSelector = [reason substringWithRange:[match rangeAtIndex:1]];
            MRStage(@"initializer_exception");
        }
        }
    };
    MRStage(@"dispatching_initializer");
    if (MRProbeEnabled()) {
        // Capture the OS's own uncaught-exception/termination message without
        // attaching a debugger or changing the third-party SDK's behavior.
        NSString *directory = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
        if (directory) {
            NSString *path = [directory stringByAppendingPathComponent:@"qishui-native-stderr.log"];
            if (freopen(path.fileSystemRepresentation, "w", stderr)) setvbuf(stderr, NULL, _IONBF, 0);
        }
    }
    // The public SDK guards its own UIKit reads with main-queue dispatch.
    // Keep initialization off UI; the Python caller awaits its worker without
    // blocking the main runloop. Never synchronously join SDK work from UI.
    if (NSThread.isMainThread) {
        @synchronized (self) { MRInitializing = NO; }
        return MRResult(NO, @"signer_worker_required");
    }
    initialize();
    @synchronized (self) {
        MRManager = manager;
        MRFailure = failure;
        MRFailureException = exceptionType;
        MRMissingNetworkSelector = missingSelector;
        MRInitializing = NO;
    }
    MRStage(@"enable_returning");
    return [self status];
}

+ (NSDictionary *)status {
    @synchronized (self) {
    NSString *stage;
    @synchronized (MRStageLock()) { stage = MRStageValue; }
    return @{ @"ok": @(!MRFailure), @"configured": @(MRConfiguration != nil),
        @"libraryAvailable": @(NSClassFromString(@"MSConfigML") != nil && NSClassFromString(@"MSManagerML") != nil),
        @"initialized": @(MRManager != nil), @"initializing": @(MRInitializing),
        @"stage": stage ?: @"", @"httpCallbackInstalled": @(MRFactor != nil),
        @"callbackInstallCount": @(MRFactorInstalls), @"signCount": @(MRSignCount),
        @"error": MRFailure ?: @"", @"exceptionType": MRFailureException ?: @"",
        @"missingNetworkSelector": MRMissingNetworkSelector ?: @"" };
    }
}

+ (NSDictionary *)signURL:(NSString *)url headers:(NSDictionary *)headers {
    if (!MRString(url, 65536) || ![headers isKindOfClass:NSDictionary.class])
        return MRResult(NO, @"signer_request_invalid");
    NSURLComponents *parts = [NSURLComponents componentsWithString:url];
    if (![parts.scheme isEqualToString:@"https"] || ![parts.host isEqualToString:@"api.qishui.com"]
        || ![parts.path hasPrefix:@"/luna/"] || parts.user || parts.password
        || (parts.port && parts.port.integerValue != 443))
        return MRResult(NO, @"signer_origin_rejected");
    for (id key in headers) {
        if (!MRString(key, 256) || ![headers[key] isKindOfClass:NSString.class]
            || [key rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location != NSNotFound
            || [headers[key] rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location != NSNotFound)
            return MRResult(NO, @"signer_headers_invalid");
    }
    @synchronized (self) {
        if (MRInitializing) return MRResult(NO, @"signer_initialization_in_progress");
        if (!MRManager) return MRResult(NO, @"signer_not_enabled");
    }
    MRHTTPFactor callback = [[TTNetworkManager shareInstance] addSecurityFactorBlock];
    if (!callback) return MRResult(NO, @"signer_http_callback_unavailable");
    @try {
            MRRecordBlockABI(@"HTTPFactor", callback);
            MRStage(@"http_sign_begin");
            NSDictionary *signedHeaders = callback(parts.URL, headers);
            MRStage(@"http_sign_returned");
            if (![signedHeaders isKindOfClass:NSDictionary.class] || !signedHeaders.count)
                return MRResult(NO, @"signer_headers_unavailable");
            NSMutableDictionary *safe = [NSMutableDictionary new];
            for (id key in signedHeaders) {
                if (MRString(key, 256) && [signedHeaders[key] isKindOfClass:NSString.class]) {
                    NSString *name = [key lowercaseString];
                    if ([name isEqualToString:@"x-helios"] || [name isEqualToString:@"x-medusa"]
                        || [name isEqualToString:@"x-argus"] || [name isEqualToString:@"x-gorgon"]
                        || [name isEqualToString:@"x-khronos"] || [name isEqualToString:@"x-ladon"]
                        || [name hasPrefix:@"x-metasec-"] || [name isEqualToString:@"x-security-argus"])
                        safe[key] = signedHeaders[key];
                }
            }
            if (!safe.count) return MRResult(NO, @"signer_required_headers_absent");
            @synchronized (self) { MRSignCount++; }
            // The caller consumes these values in memory, never through logs.
            return @{ @"ok": @YES, @"headers": safe };
    } @catch (NSException *exception) { return MRResult(NO, @"signer_call_failed"); }
}

+ (NSDictionary *)diagnostic:(NSDictionary *)configuration {
    NSString *enabled = NSProcessInfo.processInfo.environment[@"MINERADIO_IOS_SIGNER_PROBE"];
    if (![enabled isEqualToString:@"1"]) return MRResult(NO, @"signer_diagnostic_disabled");
    NSDictionary *prepared = [self configure:configuration];
    if (![prepared[@"ok"] boolValue]) return prepared;
    NSDictionary *state = [self enable];
    if (![state[@"initialized"] boolValue]) return state;
    NSDictionary *signedResult = [self signURL:@"https://api.qishui.com/luna/pc/discover?aid=386088"
                                      headers:@{ @"accept": @"application/json" }];
    NSMutableDictionary *lengths = [NSMutableDictionary new];
    if ([signedResult[@"headers"] isKindOfClass:NSDictionary.class]) {
        for (NSString *key in signedResult[@"headers"]) lengths[key] = @([signedResult[@"headers"][key] length]);
    }
    return @{ @"state": [self status], @"signed": @([signedResult[@"ok"] boolValue]),
              @"signatureLengths": lengths, @"error": signedResult[@"error"] ?: @"" };
}
@end
