export namespace core {
	
	export class ApplyResult {
	    Locale: string;
	    LocaleName: string;
	    BackupPath: string;
	    CleanBackup: string;
	    WasRunning: boolean;
	    Forced: boolean;
	    Relaunched: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ApplyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Locale = source["Locale"];
	        this.LocaleName = source["LocaleName"];
	        this.BackupPath = source["BackupPath"];
	        this.CleanBackup = source["CleanBackup"];
	        this.WasRunning = source["WasRunning"];
	        this.Forced = source["Forced"];
	        this.Relaunched = source["Relaunched"];
	    }
	}
	export class SectionProgress {
	    section: string;
	    done: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new SectionProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.section = source["section"];
	        this.done = source["done"];
	        this.total = source["total"];
	    }
	}
	export class Progress {
	    sections: SectionProgress[];
	    done: number;
	    total: number;
	    percent: number;
	
	    static createFrom(source: any = {}) {
	        return new Progress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sections = this.convertValues(source["sections"], SectionProgress);
	        this.done = source["done"];
	        this.total = source["total"];
	        this.percent = source["percent"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Issue {
	    severity: string;
	    code: string;
	    section: string;
	    key: string;
	    line: number;
	    want: number;
	    got: number;
	    missing: string[];
	    extra: string[];
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Issue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.severity = source["severity"];
	        this.code = source["code"];
	        this.section = source["section"];
	        this.key = source["key"];
	        this.line = source["line"];
	        this.want = source["want"];
	        this.got = source["got"];
	        this.missing = source["missing"];
	        this.extra = source["extra"];
	        this.message = source["message"];
	    }
	}
	export class FileReport {
	    path: string;
	    language: string;
	    name: string;
	    ok: boolean;
	    issues: Issue[];
	    progress: Progress;
	    missingKeys: number;
	    unknownKeys: number;
	
	    static createFrom(source: any = {}) {
	        return new FileReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.language = source["language"];
	        this.name = source["name"];
	        this.ok = source["ok"];
	        this.issues = this.convertValues(source["issues"], Issue);
	        this.progress = this.convertValues(source["progress"], Progress);
	        this.missingKeys = source["missingKeys"];
	        this.unknownKeys = source["unknownKeys"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LocaleInfo {
	    code: string;
	    name: string;
	    englishName: string;
	    translations: number;
	    coverage: number;
	
	    static createFrom(source: any = {}) {
	        return new LocaleInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.name = source["name"];
	        this.englishName = source["englishName"];
	        this.translations = source["translations"];
	        this.coverage = source["coverage"];
	    }
	}
	
	export class ReapplyHint {
	    needed: boolean;
	    locale: string;
	    localeFile: string;
	    name: string;
	    fileMissing: boolean;
	    appVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new ReapplyHint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.needed = source["needed"];
	        this.locale = source["locale"];
	        this.localeFile = source["localeFile"];
	        this.name = source["name"];
	        this.fileMissing = source["fileMissing"];
	        this.appVersion = source["appVersion"];
	    }
	}
	export class RestoreResult {
	    AlreadyEnglish: boolean;
	    BackupPath: string;
	    WasRunning: boolean;
	    Forced: boolean;
	    Relaunched: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RestoreResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.AlreadyEnglish = source["AlreadyEnglish"];
	        this.BackupPath = source["BackupPath"];
	        this.WasRunning = source["WasRunning"];
	        this.Forced = source["Forced"];
	        this.Relaunched = source["Relaunched"];
	    }
	}
	
	export class Status {
	    AppDir: string;
	    ResourcesDir: string;
	    AsarPath: string;
	    CleanBackupPath: string;
	    StatePath: string;
	    AppVersion: string;
	    CurrentLanguage: string;
	    LocaleName: string;
	    HasCleanBackup: boolean;
	    CleanBackupStatus: string;
	    LastPatchedAt?: string;
	    StateIsStale: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.AppDir = source["AppDir"];
	        this.ResourcesDir = source["ResourcesDir"];
	        this.AsarPath = source["AsarPath"];
	        this.CleanBackupPath = source["CleanBackupPath"];
	        this.StatePath = source["StatePath"];
	        this.AppVersion = source["AppVersion"];
	        this.CurrentLanguage = source["CurrentLanguage"];
	        this.LocaleName = source["LocaleName"];
	        this.HasCleanBackup = source["HasCleanBackup"];
	        this.CleanBackupStatus = source["CleanBackupStatus"];
	        this.LastPatchedAt = source["LastPatchedAt"];
	        this.StateIsStale = source["StateIsStale"];
	    }
	}
	export class TemplateSummary {
	    path: string;
	    from: string;
	    entries: number;
	
	    static createFrom(source: any = {}) {
	        return new TemplateSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.from = source["from"];
	        this.entries = source["entries"];
	    }
	}
	export class UpdateSummary {
	    path: string;
	    backupPath: string;
	    added: Record<string, number>;
	    addedTotal: number;
	    obsolete: Record<string, number>;
	    progress: Progress;
	
	    static createFrom(source: any = {}) {
	        return new UpdateSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.backupPath = source["backupPath"];
	        this.added = source["added"];
	        this.addedTotal = source["addedTotal"];
	        this.obsolete = source["obsolete"];
	        this.progress = this.convertValues(source["progress"], Progress);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class UIInfo {
	    saved: string;
	    messages: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new UIInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.saved = source["saved"];
	        this.messages = source["messages"];
	    }
	}

}

